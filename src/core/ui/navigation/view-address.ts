import { ownHistoryWrite } from "./history-writes";
import { whenRouterFetchesIdle } from "./screen-fetches";

/**
 * The one way a view control writes its view to the address (ARCHITECTURE §14.2 d): a replace,
 * never a push, so one back leaves the screen whatever was chosen, and a refresh or a shared link
 * keeps the view.
 *
 * **Held while the router is fetching** (found 2026-10-02, main CI on v1.3.1): Next turns an
 * address replaced by hand (`history.replaceState`) into a router "restore". One that lands while
 * a refresh of the screen is in flight (Realtime, refresh on return, pull to refresh, an action's
 * answer) leaves the refresh answering for a screen that has moved on; Next takes that for a tree
 * mismatch and loads the address in full (`dispatchRetryDueToTreeMismatch` →
 * `completeHardNavigation`, next 16.3.5–16.3.8). So the view changes on the tap, always (the
 * caller's own state), and only the address waits: it is written as soon as no router fetch is in
 * flight, on that fetch's own completion, success or failure, never after a timer. Two switches
 * during one refresh write only the last. A move to another screen meanwhile drops the write: the
 * address belongs to the screen it was chosen on.
 */

let pending: { pathname: string; href: string } | null = null;

function write(): void {
  const next = pending;
  pending = null;
  if (!next || window.location.pathname !== next.pathname) return;
  // The one hand-written address in the app (lint forbids it everywhere else).
  ownHistoryWrite(() =>
    // eslint-disable-next-line no-restricted-syntax -- the shared, held view-address write
    window.history.replaceState(null, "", next.href),
  );
}

/** Replaces the address with `href` (same pathname, the view in its query) once it is safe. */
export function replaceViewAddress(href: string): void {
  const waiting = pending !== null;
  pending = { pathname: window.location.pathname, href };
  if (!waiting) whenRouterFetchesIdle(write);
}

/** Whether a view's address is waiting to be written (for the e2e checks and tests). */
export function viewAddressWaiting(): boolean {
  return pending !== null;
}

/** Tests only: nothing waiting. */
export function resetViewAddress(): void {
  pending = null;
}
