/**
 * How old a screen shown again by back or forward is (6b.17a, ARCHITECTURE "Freshness").
 *
 * Next 16 restores a back or forward from its history cache **whatever its age**: the cache's
 * stale time (`staleTimes.dynamic`, 30 s) only applies to a tap, never to a traverse. So a list
 * drawn ten minutes ago came back exactly as it was, without another person's change since, which
 * breaks the 30 s rule the cache was set to (a cached view never outlives refresh on return's
 * interval). This module keeps what is needed to tell: when each screen was last fetched on this
 * page, and when the router last emptied its caches (a `router.refresh()` and a revalidating
 * action's answer both do, and then a back fetches the screen anew by itself). `NavProgress`
 * feeds it from the router's fetches; refresh on return asks it after each back or forward.
 * Module state: one page's lifetime, no storage.
 */

/** The age at which a restored screen is fetched again: refresh on return's own interval. */
export const RESTORED_MAX_AGE_MS = 30_000;

/**
 * Whether a screen shown again by back or forward must be fetched again: it was drawn at
 * `drawnAt`, the router last emptied its caches at `emptiedAt` (a screen drawn before that is no
 * longer cached: the router fetches it itself, so nothing more is needed), and it is older than
 * `maxAgeMs`.
 */
export function restoredNeedsRefresh({
  now,
  drawnAt,
  emptiedAt,
  maxAgeMs = RESTORED_MAX_AGE_MS,
}: {
  now: number;
  drawnAt: number;
  emptiedAt: number;
  maxAgeMs?: number;
}): boolean {
  if (drawnAt < emptiedAt) return false;
  return now - drawnAt >= maxAgeMs;
}

export interface HistoryFreshness {
  /** The router asked the server for the screen at `path` (pathname and search) at `at`. */
  fetched(path: string, at: number): void;
  /** The router emptied its caches at `at` (a refresh, a revalidating action's answer). */
  emptied(at: number): void;
  /** When the screen at `path` was drawn: its last fetch, or the page's first drawing. */
  drawnAt(path: string): number;
  /** When the router last emptied its caches. */
  emptiedAt(): number;
}

/** `firstDrawnAt`: when the page itself was loaded (its first screen came with the document). */
export function historyFreshness(firstDrawnAt: number): HistoryFreshness {
  const fetches = new Map<string, number>();
  let emptied = Number.NEGATIVE_INFINITY;
  return {
    fetched(path, at) {
      fetches.set(path, at);
    },
    emptied(at) {
      emptied = Math.max(emptied, at);
    },
    // A screen this page never fetched under its exact address (the document's own, or one a
    // view control wrote with `replaceViewAddress()`) is as old as the page, or older.
    drawnAt: (path) => fetches.get(path) ?? firstDrawnAt,
    emptiedAt: () => emptied,
  };
}

type MoveListener = (path: string) => void;

const moveListeners = new Set<MoveListener>();
let store: HistoryFreshness | null = null;

/** This page's record, made on first use (the page was drawn then, or before). */
export function pageFreshness(now: number): HistoryFreshness {
  store ??= historyFreshness(now);
  return store;
}

/** Called by `NavProgress` when back or forward moved to another address (not an overlay). */
export function noteHistoryMove(path: string): void {
  for (const listener of moveListeners) listener(path);
}

/** Hears each back or forward to another address; returns the unsubscribe. */
export function onHistoryMove(listener: MoveListener): () => void {
  moveListeners.add(listener);
  return () => {
    moveListeners.delete(listener);
  };
}
