"use client";

import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";

import { cn } from "@/core/lib/utils";
import { systemClock } from "@/core/time/clock";
import { anySendWaiting } from "@/core/ui/delayed-sends";
import { useActiveEditor } from "@/core/ui/edit/active-editor";
import { anyEditDirty } from "@/core/ui/edit/edit-guard";

import { nextScreenFetch } from "@/core/ui/navigation/screen-fetches";

import { canPull, PULL_MAX_PX, PULL_TRIGGER_PX, pullDistance } from "./pull-rules";

/** A refresh that never answers (superseded by a navigation) stops the spinner after this. */
const REFRESH_GIVE_UP_MS = 15_000;

/** Anything that owns the gesture: a sheet, a dialog, a confirmation, an open select or menu. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * The pull gesture on a tab's first screen (`pull-rules.ts` has the rules), mounted once in
 * the signed-in shell. Touch only: a mouse or a pen never pulls (the desktop keeps refresh on
 * return). The listeners are passive, so scrolling is never held up: with the page at its top
 * and the browser's overscroll off, a downward drag moves nothing else. The page itself does not
 * move either; a small spinner comes down under the title bar, and on release past the line the
 * screen's data is fetched again in place and the spinner turns until it has arrived.
 *
 * A screen still arriving must not swallow the pull (both found on CI, 2026-09-29):
 * - **`window` listens in the capture phase.** A touch on a part React has not hydrated yet (a
 *   skeleton whose screen is waiting to be revealed) is stopped by React's own capture listener
 *   on the root (`stopPropagation`, while it tries to hydrate), so it never bubbled to `window`.
 * - **The rest of a touch is also followed on the element the finger came down on:** the browser
 *   sends a touch's later events to that element even after it has left the page (the skeleton
 *   replaced by the screen mid-pull), and from there they never reach `window` at all.
 * Each event is handled once, whichever listener hears it first.
 */
export function PullToRefresh({ tabRoots }: { tabRoots: readonly string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const editor = useActiveEditor();
  const [distance, setDistance] = useState(0);
  // Its own lifetime, not a transition's: Next queues a refresh behind any router action already
  // in flight and runs it outside the caller's transition, whose pending state could then end
  // before the refresh had started (the spinner never showed on CI). It turns until the
  // refresh's own screen fetch has answered (`nextScreenFetch`), or gives up after 15 s if a
  // navigation superseded the refresh.
  const [refreshing, setRefreshing] = useState(false);
  const lastPull = useRef(0);
  const state = useRef({ tabRoots, pathname, editor });
  useEffect(() => {
    state.current = { tabRoots, pathname, editor };
  });

  useEffect(() => {
    let startY: number | null = null;
    let travelled = 0;
    // The listeners following the current touch, on the element it started on.
    let gesture: AbortController | null = null;
    const endGesture = () => {
      gesture?.abort();
      gesture = null;
    };
    // `window` (capture) and the touch's own element can both hear one event: handle it once.
    let lastEvent: Event | null = null;
    const once = (handler: (event: TouchEvent) => void) => (event: TouchEvent) => {
      if (event === lastEvent) return;
      lastEvent = event;
      handler(event);
    };

    const onMove = (event: TouchEvent) => {
      if (startY === null) return;
      const y = event.touches[0]?.clientY ?? startY;
      // Scrolled away in the meantime (a pull that turned into a scroll): not a pull.
      if (window.scrollY > 0) {
        startY = null;
        setDistance(0);
        return;
      }
      travelled = pullDistance(y - startY);
      setDistance(travelled);
    };
    const onEnd = (event: TouchEvent) => {
      endGesture();
      if (startY === null) return;
      // Measured to where the finger let go, not only to the last move the page heard: while a
      // drag might still become a scroll, the browser hands the page its moves late and few, so
      // a quick pull can end with only its first, short move seen.
      const releasedAt = event.changedTouches[0]?.clientY;
      if (releasedAt !== undefined && window.scrollY <= 0) {
        travelled = Math.max(travelled, pullDistance(releasedAt - startY));
      }
      startY = null;
      setDistance(0);
      if (travelled < PULL_TRIGGER_PX) return;
      lastPull.current = systemClock().getTime();
      setRefreshing(true);
      const answered = nextScreenFetch(location.pathname + location.search, REFRESH_GIVE_UP_MS);
      startTransition(() => router.refresh());
      void answered.then(() => setRefreshing(false));
    };
    // The browser took the gesture over (a scroll, a system gesture): nothing to refresh.
    const onCancel = () => {
      endGesture();
      startY = null;
      travelled = 0;
      setDistance(0);
    };

    const onStart = (event: TouchEvent) => {
      endGesture();
      const { tabRoots: roots, pathname: path, editor: activeEditor } = state.current;
      const allowed =
        event.touches.length === 1 &&
        canPull({
          pathname: path,
          tabRoots: roots,
          scrollY: window.scrollY,
          overlayOpen: document.querySelector(OVERLAY) !== null,
          editing: activeEditor !== null || anyEditDirty(),
          sendWaiting: anySendWaiting(),
          now: systemClock().getTime(),
          lastPull: lastPull.current,
        });
      startY = allowed ? (event.touches[0]?.clientY ?? null) : null;
      travelled = 0;
      if (startY === null) return;
      const target = event.target;
      const followed: GlobalEventHandlers =
        target instanceof HTMLElement || target instanceof SVGElement ? target : window;
      gesture = new AbortController();
      const options = { passive: true, signal: gesture.signal };
      followed.addEventListener("touchmove", move, options);
      followed.addEventListener("touchend", end, options);
      followed.addEventListener("touchcancel", cancel, options);
    };
    const start = once(onStart);
    const move = once(onMove);
    const end = once(onEnd);
    const cancel = once(onCancel);

    const onWindow = { passive: true, capture: true };
    window.addEventListener("touchstart", start, onWindow);
    window.addEventListener("touchmove", move, onWindow);
    window.addEventListener("touchend", end, onWindow);
    window.addEventListener("touchcancel", cancel, onWindow);
    // Listening: it loads after the page (`pull-to-refresh-lazy.tsx`), so this is the signal
    // that a pull now works (the e2e specs wait for it before pulling).
    document.documentElement.setAttribute("data-pull-ready", "");
    return () => {
      document.documentElement.removeAttribute("data-pull-ready");
      window.removeEventListener("touchstart", start, onWindow);
      window.removeEventListener("touchmove", move, onWindow);
      window.removeEventListener("touchend", end, onWindow);
      window.removeEventListener("touchcancel", cancel, onWindow);
      endGesture();
    };
  }, [router]);

  const shown = refreshing ? PULL_TRIGGER_PX : distance;
  if (shown === 0) return null;
  const ready = refreshing || distance >= PULL_TRIGGER_PX;
  return (
    <div
      data-slot="pull-refresh"
      data-state={refreshing ? "refreshing" : ready ? "ready" : "pulling"}
      role={refreshing ? "status" : undefined}
      aria-label={refreshing ? "Refreshing" : undefined}
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
      style={{
        top: "calc(var(--app-safe-top) + var(--app-chrome-h) + 3rem)",
        transform: `translateY(${shown - PULL_TRIGGER_PX / 2}px)`,
        opacity: Math.min(1, shown / (PULL_MAX_PX / 2)),
      }}
    >
      <span
        className={cn(
          "bg-popover text-foreground border-border flex size-9 items-center justify-center rounded-full border shadow-md",
        )}
      >
        {refreshing ? (
          <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <RefreshCwIcon
            className="size-4"
            aria-hidden
            style={{ transform: `rotate(${(shown / PULL_TRIGGER_PX) * 270}deg)` }}
          />
        )}
      </span>
    </div>
  );
}
