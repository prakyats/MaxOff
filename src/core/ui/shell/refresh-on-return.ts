"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { systemClock } from "@/core/time/clock";
import { anySendWaiting } from "@/core/ui/delayed-sends";
import { anyEditDirty } from "@/core/ui/edit/edit-guard";
import {
  onHistoryMove,
  pageFreshness,
  restoredNeedsRefresh,
} from "@/core/ui/navigation/history-freshness";

/**
 * Refresh on return (ARCHITECTURE §14.2 i, task 2.7b). Pull-to-refresh is off on purpose (2.7:
 * a pull that reloads loses what the person was doing), so freshness comes from here until
 * Realtime (5.1): when the app comes back into view or its window regains focus, the server
 * data is fetched again **in place** with `router.refresh()`: the lists, the counts, the
 * Approvals badge. No reload and no splash; open sheets, typed input and scroll stay, because
 * refresh keeps client state. The layouts' own checks run as on any navigation, so a return
 * after midnight IST meets the day gate, as a tap on any link would.
 *
 * **A screen shown again by back or forward is a return too (6b.17a).** Next restores it from its
 * history cache whatever its age, so a screen older than the same 30 s is re-read in place right
 * after it is shown (`history-freshness.ts`): the cached view appears at once, then another
 * person's change since arrives. Under the same guards; never for an overlay closing (the same
 * address), and never when the router fetches that screen anew by itself.
 */

/** Not more often than this: a quick look at another app and back costs nothing. */
export const REFRESH_MIN_INTERVAL_MS = 30_000;

/**
 * Whether a return should refresh now. Never while an approval is still inside its Undo window
 * (`anySendWaiting`): the list would come back before the send has left, and the send is the
 * one that refreshes once it lands. Nor while an editor holds unsaved changes (2.9,
 * `anyEditDirty`): what someone is typing stays exactly as they left it.
 */
export function shouldRefresh({
  now,
  lastRefresh,
  sendWaiting,
  editing = false,
}: {
  now: number;
  lastRefresh: number;
  sendWaiting: boolean;
  editing?: boolean;
}): boolean {
  return !sendWaiting && !editing && now - lastRefresh >= REFRESH_MIN_INTERVAL_MS;
}

/** Mounted once in the signed-in layout. The page it mounts on was just rendered: fresh. */
export function RefreshOnReturn(): null {
  const router = useRouter();
  useEffect(() => {
    // Elapsed time, but on the wall clock: a phone's monotonic clock (`performance.now()`)
    // stops while it sleeps, so a return in the morning would read as seconds later.
    let lastRefresh = systemClock().getTime();
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      const now = systemClock().getTime();
      if (
        !shouldRefresh({
          now,
          lastRefresh,
          sendWaiting: anySendWaiting(),
          editing: anyEditDirty(),
        })
      )
        return;
      lastRefresh = now;
      router.refresh();
    };
    // After the router's own handling of the back (the restore is queued first, then this
    // refresh of the screen it restored): the next task, never a timer.
    const onRestored = (path: string) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        const now = systemClock().getTime();
        const freshness = pageFreshness(now);
        if (anySendWaiting() || anyEditDirty()) return;
        const stale = restoredNeedsRefresh({
          now,
          drawnAt: freshness.drawnAt(path),
          emptiedAt: freshness.emptiedAt(),
        });
        if (!stale) return;
        lastRefresh = now;
        router.refresh();
      };
      channel.port2.postMessage(null);
    };
    const stopHearing = onHistoryMove(onRestored);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      stopHearing();
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [router]);
  return null;
}
