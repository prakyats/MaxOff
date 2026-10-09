"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { createRealtimeSupabase, type RealtimeSupabase } from "@/core/db/browser";
import { getInBackground } from "@/core/http/background";
import { systemClock } from "@/core/time/clock";
import { anySendWaiting } from "@/core/ui/delayed-sends";
import { anyEditDirty } from "@/core/ui/edit/edit-guard";

import {
  catchUpRefreshes,
  LIVE_DASHBOARD_TABLES,
  LIVE_REFRESH_DELAY_MS,
  LIVE_REFRESH_RETRY_MS,
  liveDashboard,
  liveRefreshWaits,
  OWN_READ_QUIET_MS,
  TOKEN_RETRY_MS,
  tokenRefreshIn,
} from "../live-rules";
import { noteNotificationsChanged, ownReadWithin } from "../live-state";
import {
  newestServerUnread,
  readInFlight,
  readsUnconfirmed,
  type ServerUnread,
  serverUnreadSeen,
} from "../read-receipts";

/**
 * The bell's count alone, nothing revalidated. A **background call** (ARCHITECTURE §4.4): a
 * Realtime callback or a timer asks for it, so it is a plain request to a route handler, never a
 * server action, which Next would hold a navigation for when it went out during one (the first
 * join's count did, CI run 37118131079).
 */
function readUnreadCount() {
  return getInBackground<ServerUnread>("/api/notifications/unread");
}

export type LiveUpdatesProps = {
  memberId: string;
  /** The member's access token (`getRealtimeAuth()`), handed over by the layout. */
  token: string;
  /** Seconds the token has left, by the server's clock. */
  expiresIn: number | null;
};

/**
 * The live bell (task 5.1, ARCHITECTURE §10): subscribes to Realtime `postgres_changes` on the
 * member's own `notifications` (RLS-filtered by the server as well as by `recipient_id`), and on
 * any insert or read receipt re-reads the screen in place, so the bell, the Alerts badge and the
 * history list follow without a reload: a new notification, a row read on another device, Mark
 * all read. The event's row is never shown. A rejoin after a dropped connection re-reads too (what
 * came meanwhile). The **first** join asks for the count once (`catchUpRefreshes`): a row written
 * between the page's render and the join sent no event. Refresh on return (2.7b) stays the
 * fallback when Realtime is unreachable.
 * The member's **own** reads on this device never re-read the screen (owner decision 2026-10-01):
 * their receipts only ask the server for the bell's count (`GET /api/notifications/unread`,
 * nothing revalidated), which confirms the drop the device already shows (`read-receipts.ts`).
 * `html[data-live]` says whether the channel is joined (`on`) or not (`off`), for the e2e checks.
 *
 * **The day screens (6A, Kickoff 6 decision 8):** on `/today` and `/my-day` (and since kickoff 7
 * decision 24 `/approvals`) the same client joins a second channel (`dashboard:<id>`) listening to
 * `tasks`, `task_assignees`, `attendance_days`, `leave_requests` and `project_items` (7B) with no
 * filter of its own: Realtime sends only the rows the member's RLS
 * lets them select, and any of them re-reads the screen the same way (throttled, through the same
 * guard). It leaves when the screen does; a rejoin after a drop re-reads. `html[data-live-dashboard]`
 * says whether it is joined. Never a second client, never the row's content on screen.
 *
 * Every refresh, the token's included, goes through one guard (`liveRefreshWaits`: never inside
 * an approval's Undo window, over unsaved edits or mid-navigation). The token comes from the
 * server on every render of the layout; just after it expires the page asks for a new one, and
 * keeps asking while the one in hand is spent.
 */
export function LiveUpdates({ memberId, token, expiresIn }: LiveUpdatesProps): null {
  const router = useRouter();
  const pathname = usePathname();
  const tokenRef = useRef(token);
  const client = useRef<RealtimeSupabase | null>(null);
  // Resolves once the client has the member's token (a channel joined before it joins as anon).
  const authorised = useRef<Promise<void> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const confirmTimer = useRef<number | undefined>(undefined);

  // The member's own reads: the count alone, never the screen. A count that cannot be read is
  // left to the next refresh.
  const confirmSoon = useCallback(() => {
    window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => {
      void readUnreadCount().then((result) => {
        if (result.ok) serverUnreadSeen(result.data);
      });
    }, LIVE_REFRESH_DELAY_MS);
  }, []);

  const refreshSoon = useCallback(
    (delay: number) => {
      const schedule = (wait: number) => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          if (
            liveRefreshWaits({
              sendWaiting: anySendWaiting(),
              editing: anyEditDirty(),
              navigating: document.documentElement.hasAttribute("data-nav-pending"),
            })
          ) {
            schedule(LIVE_REFRESH_RETRY_MS);
            return;
          }
          router.refresh();
        }, wait);
      };
      schedule(delay);
    },
    [router],
  );

  // The first join: what came between the server's count and the join (see `catchUpRefreshes`).
  const catchUp = useCallback(() => {
    const before = newestServerUnread();
    void readUnreadCount().then((result) => {
      if (!result.ok) return;
      serverUnreadSeen(result.data);
      if (catchUpRefreshes(before, result.data, readsUnconfirmed())) {
        refreshSoon(LIVE_REFRESH_DELAY_MS);
      }
    });
  }, [refreshSoon]);

  useEffect(() => {
    const supabase = createRealtimeSupabase(async () => tokenRef.current);
    client.current = supabase;
    const root = document.documentElement;
    // The member's token first: a channel that joins before it (supabase-js sets it a tick
    // after the client is made) joins as `anon`, and Realtime then refuses every row (401).
    let cancelled = false;
    let joinedOnce = false;
    let channel: ReturnType<RealtimeSupabase["channel"]> | null = null;
    const ready = supabase.realtime.setAuth();
    authorised.current = ready;
    void ready.then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`notifications:${memberId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `recipient_id=eq.${memberId}`,
          },
          (change) => {
            noteNotificationsChanged();
            // The member's own read on this device never re-reads the screen: the count alone
            // confirms it, once, while a read still waits for it.
            if (
              change.eventType === "UPDATE" &&
              (readInFlight() || ownReadWithin(systemClock().getTime(), OWN_READ_QUIET_MS))
            ) {
              if (readsUnconfirmed()) confirmSoon();
              return;
            }
            refreshSoon(LIVE_REFRESH_DELAY_MS);
          },
        )
        .subscribe((status) => {
          const joined = status === "SUBSCRIBED";
          root.dataset.live = joined ? "on" : "off";
          // Joined again after a drop: what arrived meanwhile sent no event here. Joined for the
          // first time: what arrived since the page's count, the count alone unless it changed.
          if (joined && joinedOnce) refreshSoon(LIVE_REFRESH_DELAY_MS);
          else if (joined) catchUp();
          if (joined) joinedOnce = true;
        });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
      window.clearTimeout(confirmTimer.current);
      client.current = null;
      authorised.current = null;
      delete root.dataset.live;
      const joined = channel;
      void (joined ? supabase.removeChannel(joined) : Promise.resolve()).finally(() =>
        supabase.realtime.disconnect(),
      );
    };
  }, [memberId, refreshSoon, confirmSoon, catchUp]);

  // The day screens' channel (6A): joined on /today and /my-day only, on the same client. Its
  // re-reads have their own timer, dropped when the screen is left, and re-check the screen when
  // they fire: a refresh that lands on another screen, during a back press, can make Next load
  // the page in full (CI run 37578637275; PROGRESS "The view's address").
  useEffect(() => {
    const supabase = client.current;
    const ready = authorised.current;
    if (!liveDashboard(pathname) || !supabase || !ready) return;
    const root = document.documentElement;
    let cancelled = false;
    let joinedOnce = false;
    let timer: number | undefined;
    let channel: ReturnType<RealtimeSupabase["channel"]> | null = null;
    const reread = (wait: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (cancelled || !liveDashboard(window.location.pathname)) return;
        if (
          liveRefreshWaits({
            sendWaiting: anySendWaiting(),
            editing: anyEditDirty(),
            navigating: root.hasAttribute("data-nav-pending"),
          })
        ) {
          reread(LIVE_REFRESH_RETRY_MS);
          return;
        }
        router.refresh();
      }, wait);
    };
    void ready.then(() => {
      if (cancelled) return;
      let next = supabase.channel(`dashboard:${memberId}`);
      // Inserts and updates: nothing in these tables is ever deleted (invariant 9), and Realtime
      // checks no DELETE against RLS (it carries the id alone), so a delete is not listened to.
      for (const table of LIVE_DASHBOARD_TABLES) {
        for (const event of ["INSERT", "UPDATE"] as const) {
          next = next.on("postgres_changes", { event, schema: "public", table }, () =>
            reread(LIVE_REFRESH_DELAY_MS),
          );
        }
      }
      channel = next.subscribe((status) => {
        const joined = status === "SUBSCRIBED";
        root.dataset.liveDashboard = joined ? "on" : "off";
        // Joined again after a drop: what changed meanwhile sent no event here.
        if (joined && joinedOnce) reread(LIVE_REFRESH_DELAY_MS);
        if (joined) joinedOnce = true;
      });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      delete root.dataset.liveDashboard;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [pathname, memberId, router]);

  // A new token from the server: Realtime reads it through the callback.
  useEffect(() => {
    if (tokenRef.current === token) return;
    tokenRef.current = token;
    void client.current?.realtime.setAuth();
  }, [token]);

  // Just after this token expires, ask for a new one; while none has come, ask again.
  useEffect(() => {
    const delay = tokenRefreshIn(expiresIn);
    if (delay === null) return;
    let retry: number | undefined;
    const ask = () => {
      refreshSoon(0);
      retry = window.setTimeout(ask, TOKEN_RETRY_MS);
    };
    const first = window.setTimeout(ask, delay);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(retry);
    };
  }, [token, expiresIn, refreshSoon]);

  return null;
}
