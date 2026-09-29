"use client";

import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { cn } from "@/core/lib/utils";
import { systemClock } from "@/core/time/clock";
import { anySendWaiting } from "@/core/ui/delayed-sends";
import { useActiveEditor } from "@/core/ui/edit/active-editor";
import { anyEditDirty } from "@/core/ui/edit/edit-guard";

import { canPull, PULL_MAX_PX, PULL_TRIGGER_PX, pullDistance } from "./pull-rules";

/** Anything that owns the gesture: a sheet, a dialog, a confirmation, an open select or menu. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * The pull gesture on a tab's first screen (`pull-rules.ts` has the rules), mounted once in
 * the signed-in shell. Touch only: a mouse or a pen never pulls (the desktop keeps refresh on
 * return). The listeners are passive, so scrolling is never held up: with the page at its top
 * and the browser's overscroll off, a downward drag moves nothing else. The page itself does not
 * move either; a small spinner comes down under the title bar, and on release past the line the
 * screen's data is fetched again in place and the spinner turns until it has arrived.
 */
export function PullToRefresh({ tabRoots }: { tabRoots: readonly string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const editor = useActiveEditor();
  const [distance, setDistance] = useState(0);
  const [refreshing, startRefresh] = useTransition();
  const lastPull = useRef(0);
  const state = useRef({ tabRoots, pathname, editor });
  useEffect(() => {
    state.current = { tabRoots, pathname, editor };
  });

  useEffect(() => {
    let startY: number | null = null;
    let travelled = 0;

    const onStart = (event: TouchEvent) => {
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
      startRefresh(() => router.refresh());
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
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
