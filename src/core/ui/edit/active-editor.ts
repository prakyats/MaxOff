"use client";

import { useSyncExternalStore } from "react";

/**
 * One record in edit mode at a time (3.4 review): a page with several `EditableRecord`s (a
 * client's Overview) would otherwise stack two sticky Save bars in one place, two red commits in
 * one layer and two history layers. The record that starts editing claims the page; the others
 * hide their Edit until it is released.
 */

let active: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Claims edit mode for `id`; false when another record holds it. */
export function claimEditor(id: string): boolean {
  if (active !== null && active !== id) return false;
  if (active !== id) {
    active = id;
    emit();
  }
  return true;
}

export function releaseEditor(id: string): void {
  if (active !== id) return;
  active = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The id of the record in edit mode, or null. */
export function useActiveEditor(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => active,
    () => null,
  );
}
