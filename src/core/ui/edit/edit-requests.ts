"use client";

import { useEffect, useRef } from "react";

/**
 * "Edit" from somewhere other than the record's own button (task 3.4): the ⋯ menu in a page
 * header, or a list's sheet that opens the record's page. The menu and the record are separate
 * components (the header lives in a layout, the record in a page), so they meet here by key.
 *
 * `requestEdit(key)` starts editing the mounted record with that key; with none mounted yet (the
 * menu navigated to the record's page first) the request waits and the record takes it when it
 * mounts. A request is used once.
 */

const pending = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

export function requestEdit(key: string): void {
  const current = listeners.get(key);
  if (current && current.size > 0) {
    for (const listener of current) listener();
    return;
  }
  pending.add(key);
}

/** Subscribes `onRequest` to `key`; returns the unsubscribe. Takes a request left waiting. */
export function subscribeEditRequest(key: string, onRequest: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(onRequest);
  listeners.set(key, set);
  if (pending.delete(key)) onRequest();
  return () => {
    set.delete(onRequest);
    if (set.size === 0) listeners.delete(key);
  };
}

/** Forgets every waiting request (tests). */
export function clearEditRequests(): void {
  pending.clear();
  listeners.clear();
}

/** The record's side: `onRequest` runs for every `requestEdit(key)` while mounted. */
export function useEditRequest(key: string | undefined, onRequest: () => void): void {
  const ref = useRef(onRequest);
  useEffect(() => {
    ref.current = onRequest;
  });
  useEffect(() => {
    if (!key) return;
    return subscribeEditRequest(key, () => ref.current());
  }, [key]);
}
