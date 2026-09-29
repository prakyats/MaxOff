/**
 * The router's screen fetches, observed (`NavProgress` patches `fetch` once and reports each one
 * here). Pull-to-refresh uses it to know when its refresh has really answered: Next queues a
 * `router.refresh()` behind any router action already in flight and runs it outside the caller's
 * transition, so a transition's pending state can end before the refresh has even started (found
 * on CI: the spinner never showed, 2026-09-29).
 */

type Listener = (path: string) => void;

const listeners = new Set<Listener>();

/** Called by `NavProgress` when a screen fetch (not a prefetch, not an action) has answered. */
export function noteScreenFetchSettled(path: string): void {
  for (const listener of listeners) listener(path);
}

/**
 * Resolves when the next screen fetch for `path` (pathname and search) has answered, or after
 * `timeoutMs` if none does (Next drops a queued refresh when a navigation supersedes it).
 */
export function nextScreenFetch(path: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      listeners.delete(listener);
      window.clearTimeout(timer);
      resolve();
    };
    const listener: Listener = (settled) => {
      if (settled === path) done();
    };
    const timer = window.setTimeout(done, timeoutMs);
    listeners.add(listener);
  });
}
