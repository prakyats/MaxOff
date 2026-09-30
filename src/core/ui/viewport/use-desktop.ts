"use client";

import { useSyncExternalStore } from "react";

/** The shell's line between the phone layout and the desktop one (ARCHITECTURE §14.1: `md`). */
export const DESKTOP_QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the screen has the desktop layout (`md` up), live. **Null on the server and until
 * hydration**: what the page draws before it knows is decided by CSS (`md:` classes), and a
 * behaviour that differs by layout (a sheet on a phone, a view on a desktop) reads this at the tap.
 */
export function useIsDesktop(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => null,
  );
}
