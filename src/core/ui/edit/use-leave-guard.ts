"use client";

import { useEffect, useId, useRef } from "react";

import { setEditDirty } from "./edit-guard";
import { isLeavingClick } from "./leave-guard";

/**
 * While `dirty`, every way of leaving the page asks first (ARCHITECTURE §14.2 f, task 2.9):
 *
 * - **An in-app link** (a tab, the on-screen back, the More sheet, the sidebar): the click is
 *   caught on `window` in the capture phase, before React, Next or the pre-hydration script see
 *   it, and `onLeave(resume)` is called. `resume` replays the same click once the changes are
 *   discarded, so the tab rules and the back control behave exactly as they would have.
 * - **A reload or closing the tab:** the browser's own `beforeunload` prompt.
 * - **Log out:** its confirmation warns (`anyEditDirty()` in `logout-confirm.tsx`).
 * - **The back gesture** is the editor's own history layer (`useOverlayHistory`), not this hook.
 */
export function useLeaveGuard(dirty: boolean, onLeave: (resume: () => void) => void): void {
  const id = useId();
  const onLeaveRef = useRef(onLeave);
  // The replayed click must pass: React removes the listener only after the next commit.
  const replaying = useRef(false);
  useEffect(() => {
    onLeaveRef.current = onLeave;
  });

  useEffect(() => {
    setEditDirty(id, dirty);
    if (!dirty) return;

    const onClick = (event: MouseEvent) => {
      if (replaying.current) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || !isLeavingClick(event, anchor, window.location.origin)) return;
      event.preventDefault();
      event.stopPropagation();
      onLeaveRef.current(() => {
        replaying.current = true;
        try {
          anchor.click();
        } finally {
          replaying.current = false;
        }
      });
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      setEditDirty(id, false);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [id, dirty]);
}
