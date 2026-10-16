"use client";

import { useSyncExternalStore } from "react";

import { type ConnectionHint, wantsLessData } from "./prefetch-choice";

type ConnectionLike = ConnectionHint & {
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

function connection(): ConnectionLike | undefined {
  return typeof navigator === "undefined"
    ? undefined
    : (navigator as { connection?: ConnectionLike }).connection;
}

function subscribe(onChange: () => void): () => void {
  const api = connection();
  api?.addEventListener?.("change", onChange);
  return () => api?.removeEventListener?.("change", onChange);
}

/**
 * The setting as it is now, for an effect: the hook's first client render still reports the
 * server's `false` (hydration), and an effect of that render must not prefetch on it.
 */
export function lessDataNow(): boolean {
  return wantsLessData(connection());
}

/**
 * True while the browser asks to save data (`navigator.connection.saveData`, P2 item 6): no
 * prefetch beyond Next's own is made then (`prefetch-choice.ts`). False on the server and for the
 * first client render, then the real value, and it follows a change of the setting.
 */
export function useLessData(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => wantsLessData(connection()),
    () => false,
  );
}
