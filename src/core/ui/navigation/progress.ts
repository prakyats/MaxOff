/**
 * The navigation progress bar's shared rules (ARCHITECTURE §14.2 i). The bar is driven by two
 * attributes, so CSS can draw it before React has hydrated (`globals.css`):
 *
 * - `data-nav-pending` on `<html>`: a navigation is under way (the value is when it started, in
 *   ms since the epoch, so the slow messages count from the tap even across hydration);
 * - `data-nav-target` on the link that was tapped: the bottom bar highlights that tab at once,
 *   with a small pending dot, before the destination has answered.
 *
 * Started by a tap (the pre-hydration script's click listener, which runs before and after
 * hydration) and by any navigation fetch the router makes (`NavProgress`, so `router.push` and
 * `router.replace` anywhere start it too); finished by `NavProgress` once the new screen is there.
 */

export const NAV_PENDING_ATTRIBUTE = "data-nav-pending";
export const NAV_DONE_ATTRIBUTE = "data-nav-done";
export const NAV_TARGET_ATTRIBUTE = "data-nav-target";

/** After this long, the bar area says the connection is slow (§14.2 i, owner 2026-09-28). */
export const NAV_SLOW_MS = 8_000;
/** After this long, it offers Retry: the same navigation again. */
export const NAV_RETRY_MS = 10_000;
/** After this long, it also offers Reload: a full load of the destination, the last resort. */
export const NAV_RELOAD_MS = 25_000;

type Place = { origin: string; pathname: string; search: string };

/**
 * Whether a plain click on a same-document link starts a navigation the bar should show: same
 * origin, and somewhere else (a hash-only link, or the page you are on, is not a navigation).
 * Modified clicks, other targets and downloads are filtered by the caller. Written without
 * closures or imports: the pre-hydration script carries its source (`startsNavigation.toString()`).
 */
export function startsNavigation(link: Place, current: Place): boolean {
  if (link.origin !== current.origin) return false;
  if (link.pathname.indexOf("/api/") === 0) return false;
  return link.pathname !== current.pathname || link.search !== current.search;
}

/** What the bar area says after `elapsed` ms of one navigation. */
export type NavStage = "working" | "slow" | "retry" | "reload";

export function navStage(elapsed: number): NavStage {
  if (elapsed >= NAV_RELOAD_MS) return "reload";
  if (elapsed >= NAV_RETRY_MS) return "retry";
  if (elapsed >= NAV_SLOW_MS) return "slow";
  return "working";
}

/**
 * Whether a fetch is the router asking for a screen (a navigation or a refresh), not a prefetch
 * and not a server action: a GET with `RSC: 1` and no `Next-Router-Prefetch`.
 */
export function isNavigationFetch(method: string, headers: Headers): boolean {
  return (
    method.toUpperCase() === "GET" &&
    headers.get("rsc") === "1" &&
    !headers.has("next-router-prefetch") &&
    !headers.has("next-action")
  );
}
