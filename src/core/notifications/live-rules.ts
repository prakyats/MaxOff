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

/** While the token in hand has expired, the page asks again this often until a new one comes. */
export const TOKEN_RETRY_MS = 30_000;

/**
 * After the member's own read (sent or answered), the read receipts it causes come back as UPDATE
 * events: for this long they only confirm the bell's count, never re-read the screen (owner
 * decision 2026-10-01: a read never refreshes the page). A new notification (an INSERT) always
 * re-reads it, and so does a read from another device outside the window.
 */
export const OWN_READ_QUIET_MS = 3_000;

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
 * When to ask for a fresh token (ms after the token arrived): just after it expires, when the
 * proxy refreshes the session on the request, so the layout hands over the new one. Measured
 * from the token's remaining lifetime **by the server's clock** (`expiresIn`), so a phone whose
 * clock runs fast or slow asks at the right moment. A token that arrived already spent (the
 * proxy could not renew it just then) is asked about again after `TOKEN_RETRY_MS`, never in a
 * tight loop. Null: no expiry known.
 */
export function tokenRefreshIn(expiresInSeconds: number | null): number | null {
  if (expiresInSeconds === null) return null;
  if (expiresInSeconds <= 0) return TOKEN_RETRY_MS;
  return expiresInSeconds * 1000 + TOKEN_GRACE_MS;
}
