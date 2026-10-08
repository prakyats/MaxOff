/**
 * The app's own history writes, told apart from the router's. Next writes its entry (`__NA`) on
 * every commit (`HistoryUpdater`) and copies that marker into any entry written by hand, so the
 * app's writes (an overlay's entry, a view's address) say so here while they run; `NavProgress`
 * counts every other `__NA` write as a router commit (`noteRouterCommitted`).
 */

let depth = 0;

/** Runs `write` (a `history.pushState`/`replaceState` of the app's own) marked as the app's. */
export function ownHistoryWrite(write: () => void): void {
  depth += 1;
  try {
    write();
  } finally {
    depth -= 1;
  }
}

/** Whether a history write happening now is the app's own. */
export function writingOwnHistory(): boolean {
  return depth > 0;
}
