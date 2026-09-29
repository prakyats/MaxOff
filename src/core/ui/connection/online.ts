"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the device thinks it is online (ARCHITECTURE §14.1, owner 2026-09-28): the offline
 * banner and every commit button read this. `navigator.onLine` is the browser's own answer: false
 * means certainly offline (airplane mode, no signal); true can still be a dead connection, which
 * the action's own failure ("Couldn't reach MaxOff") covers.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Online until the browser says otherwise; the server render assumes online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/** The offline banner's id: a disabled commit button points at it for its reason. */
export const OFFLINE_BANNER_ID = "offline-banner";

export const OFFLINE_MESSAGE = "You're offline. Changes won't be saved until you're back online.";
