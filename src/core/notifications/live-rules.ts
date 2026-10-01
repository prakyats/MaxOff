/**
 * The rules of the live bell (task 5.1, ARCHITECTURE §10), kept pure so they are tested alone.
 * A Realtime event about the member's notifications re-reads the screen in place
 * (`router.refresh()`): the bell, the Alerts badge and the history list come from the server, and
 * the event's row is never shown (RLS stays the source of truth).
 */

/** Events that land together (Mark all read, a transition telling several) refresh once. */
export const LIVE_REFRESH_DELAY_MS = 400;

/** A refresh that had to wait (see `liveRefreshWaits`) tries again this much later. */
export const LIVE_REFRESH_RETRY_MS = 2_000;

/** How long after the access token expires the page asks the server for a new one. */
export const TOKEN_GRACE_MS = 5_000;

/**
 * Whether a refresh waits for now, as refresh on return does: never while an approval is inside
 * its Undo window or an editor holds unsaved changes, and not in the middle of a navigation (the
 * deep-link entry's two steps): the router would queue it behind the move and re-read a screen
 * that is about to go.
 */
export function liveRefreshWaits(state: {
  sendWaiting: boolean;
  editing: boolean;
  navigating: boolean;
}): boolean {
  return state.sendWaiting || state.editing || state.navigating;
}

/**
 * When to ask for a fresh token (ms from now): just after the current one expires, when the
 * proxy refreshes the session on the request, so the layout hands over the new one. Never
 * sooner than the grace, so a clock that runs ahead cannot make it spin. Null: no expiry known.
 */
export function tokenRefreshIn(expiresAtSeconds: number | null, nowMs: number): number | null {
  if (expiresAtSeconds === null) return null;
  return Math.max(expiresAtSeconds * 1000 - nowMs + TOKEN_GRACE_MS, TOKEN_GRACE_MS);
}
