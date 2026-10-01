"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { createRealtimeSupabase, type RealtimeSupabase } from "@/core/db/browser";
import { systemClock } from "@/core/time/clock";
import { anySendWaiting } from "@/core/ui/delayed-sends";
import { anyEditDirty } from "@/core/ui/edit/edit-guard";

import {
  LIVE_REFRESH_DELAY_MS,
  LIVE_REFRESH_RETRY_MS,
  liveRefreshWaits,
  OWN_READ_QUIET_MS,
  TOKEN_RETRY_MS,
  tokenRefreshIn,
} from "../live-rules";
import { noteNotificationsChanged, ownReadWithin } from "../live-state";

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
 * came meanwhile). Refresh on return (2.7b) stays the fallback when Realtime is unreachable.
 * `html[data-live]` says whether the channel is joined (`on`) or not (`off`), for the e2e checks.
 *
 * Every refresh, the token's included, goes through one guard (`liveRefreshWaits`: never inside
 * an approval's Undo window, over unsaved edits or mid-navigation). The token comes from the
 * server on every render of the layout; just after it expires the page asks for a new one, and
 * keeps asking while the one in hand is spent.
 */
export function LiveUpdates({ memberId, token, expiresIn }: LiveUpdatesProps): null {
  const router = useRouter();
  const tokenRef = useRef(token);
  const client = useRef<RealtimeSupabase | null>(null);
  const timer = useRef<number | undefined>(undefined);

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

  useEffect(() => {
    const supabase = createRealtimeSupabase(async () => tokenRef.current);
    client.current = supabase;
    const root = document.documentElement;
    // The member's token first: a channel that joins before it (supabase-js sets it a tick
    // after the client is made) joins as `anon`, and Realtime then refuses every row (401).
    let cancelled = false;
    let joinedOnce = false;
    let channel: ReturnType<RealtimeSupabase["channel"]> | null = null;
    void supabase.realtime.setAuth().then(() => {
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
            // The member's own read already re-read the screen: its receipts need no second one.
            if (
              change.eventType === "UPDATE" &&
              ownReadWithin(systemClock().getTime(), OWN_READ_QUIET_MS)
            ) {
              return;
            }
            refreshSoon(LIVE_REFRESH_DELAY_MS);
          },
        )
        .subscribe((status) => {
          const joined = status === "SUBSCRIBED";
          root.dataset.live = joined ? "on" : "off";
          // Joined again after a drop: what arrived meanwhile sent no event here.
          if (joined && joinedOnce) refreshSoon(LIVE_REFRESH_DELAY_MS);
          if (joined) joinedOnce = true;
        });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
      client.current = null;
      delete root.dataset.live;
      const joined = channel;
      void (joined ? supabase.removeChannel(joined) : Promise.resolve()).finally(() =>
        supabase.realtime.disconnect(),
      );
    };
  }, [memberId, refreshSoon]);

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
