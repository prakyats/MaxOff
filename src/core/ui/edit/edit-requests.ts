"use client";

import { useEffect, useRef } from "react";

import { systemClock } from "@/core/time";

/**
 * "Edit" from somewhere other than the record's own button (task 3.4): the ⋯ menu in a page
 * header, or a list's sheet that opens the record's page. The menu and the record are separate
 * components (the header lives in a layout, the record in a page), so they meet here by key.
 *
 * `requestEdit(key)` starts editing the mounted record with that key; with none mounted yet (the
 * menu navigated to the record's page first) the request waits and the record takes it when it
 * mounts. A request is used once, and lapses after a few seconds, so a navigation that never
 * happened (a link opened in a new tab) cannot start editing on a later visit.
 */

/** A request waits this long for its record to mount, then lapses (3.4 review). */
const WAIT_MS = 5000;

const pending = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

export function requestEdit(key: string): void {
  const current = listeners.get(key);
  if (current && current.size > 0) {
    for (const listener of current) listener();
    return;
  }
  pending.set(key, systemClock().getTime());
}

/** Subscribes `onRequest` to `key`; returns the unsubscribe. Takes a request left waiting. */
export function subscribeEditRequest(key: string, onRequest: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(onRequest);
  listeners.set(key, set);
  const at = pending.get(key);
  pending.delete(key);
  if (at !== undefined && systemClock().getTime() - at <= WAIT_MS) onRequest();
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
