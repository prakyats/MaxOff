"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { createRealtimeSupabase, type RealtimeSupabase } from "@/core/db/browser";
import { systemClock } from "@/core/time/clock";
import { anySendWaiting } from "@/core/ui/delayed-sends";
import { anyEditDirty } from "@/core/ui/edit/edit-guard";

import { noteNotificationsChanged } from "../live-state";
import {
  LIVE_REFRESH_DELAY_MS,
  LIVE_REFRESH_RETRY_MS,
  liveRefreshWaits,
  tokenRefreshIn,
} from "../live-rules";

export type LiveUpdatesProps = {
  memberId: string;
  /** The member's access token (`getRealtimeAuth()`), handed over by the layout. */
  token: string;
  /** The token's expiry, in seconds. */
  expiresAt: number | null;
};

/**
 * The live bell (task 5.1, ARCHITECTURE §10): subscribes to Realtime `postgres_changes` on the
 * member's own `notifications` (RLS-filtered by the server as well as by `recipient_id`), and on
 * any insert or read receipt re-reads the screen in place, so the bell, the Alerts badge and the
 * history list follow without a reload: a new notification, a row read on another device, Mark
 * all read. The event's row is never shown. Refresh on return (2.7b) stays the fallback when
 * Realtime is unreachable. `html[data-live]` says whether the channel is joined (`on`) or not
 * (`off`), for the e2e checks.
 *
 * The token comes from the server on every render of the layout; just after it expires the page
 * asks for a new one (`router.refresh()`, when the proxy refreshes the session).
 */
export function LiveUpdates({ memberId, token, expiresAt }: LiveUpdatesProps): null {
  const router = useRouter();
  const tokenRef = useRef(token);
  const client = useRef<RealtimeSupabase | null>(null);

  useEffect(() => {
    const supabase = createRealtimeSupabase(async () => tokenRef.current);
    client.current = supabase;
    const root = document.documentElement;
    let timer: number | undefined;
    const refreshSoon = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (
          liveRefreshWaits({
            sendWaiting: anySendWaiting(),
            editing: anyEditDirty(),
            navigating: root.hasAttribute("data-nav-pending"),
          })
        ) {
          refreshSoon(LIVE_REFRESH_RETRY_MS);
          return;
        }
        router.refresh();
      }, delay);
    };
    // The member's token first: a channel that joins before it (supabase-js sets it a tick
    // after the client is made) joins as `anon`, and Realtime then refuses every row (401).
    let cancelled = false;
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
          () => {
            noteNotificationsChanged();
            refreshSoon(LIVE_REFRESH_DELAY_MS);
          },
        )
        .subscribe((status) => {
          root.dataset.live = status === "SUBSCRIBED" ? "on" : "off";
        });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      client.current = null;
      delete root.dataset.live;
      const joined = channel;
      void (joined ? supabase.removeChannel(joined) : Promise.resolve()).finally(() =>
        supabase.realtime.disconnect(),
      );
    };
  }, [memberId, router]);

  // A new token from the server: Realtime reads it through the callback.
  useEffect(() => {
    if (tokenRef.current === token) return;
    tokenRef.current = token;
    void client.current?.realtime.setAuth();
  }, [token]);

  useEffect(() => {
    const delay = tokenRefreshIn(expiresAt, systemClock().getTime());
    if (delay === null) return;
    const timer = window.setTimeout(() => router.refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [expiresAt, router]);

  return null;
}
