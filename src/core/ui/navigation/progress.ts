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
/**
 * On `<html>` once `NavProgress` is listening (the router's fetches and commits are counted and
 * the bar is driven); gone again if it unmounts. It must be there before the shell takes taps
 * (`data-chrome`, which `e2e/helpers.ts`'s `hydrated` waits for): a router fetch sent before it
 * is never counted, and the bar then stands down as if the tap went nowhere (CI run 37904970460).
 */
export const NAV_READY_ATTRIBUTE = "data-nav-ready";

/**
 * After this long, a quiet line under the bar says "Still loading" with Retry (§14.2 i, owner
 * 2026-09-29): before it, the bar alone.
 */
export const NAV_SLOW_MS = 8_000;
/** After this long, Retry reloads the destination in full instead of asking the router again. */
export const NAV_RELOAD_MS = 25_000;
/**
 * Once the destination's fetch has answered and its address is showing, the bar finishes within
 * this long even if a skeleton is still in `main` (a section that loads on its own later).
 */
export const NAV_SETTLE_MS = 3_000;

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

/** What the bar area offers after `elapsed` ms of one navigation. */
export type NavStage = "working" | "slow" | "stuck";

export function navStage(elapsed: number): NavStage {
  if (elapsed >= NAV_RELOAD_MS) return "stuck";
  if (elapsed >= NAV_SLOW_MS) return "slow";
  return "working";
}

/**
 * Whether a navigation that begins now is already heading for another address: a router screen
 * fetch for one is in flight (`inFlight`, the addresses of the counted fetches not yet answered).
 * Next sends a link's screen fetch from inside its own click handler, before `NavProgress` hears
 * the tap (its listener is the last to run), so that fetch is counted before the navigation
 * begins and must not be forgotten when it does (CI run 37781084919: forgotten, the answered
 * fetch read as a refresh of the screen being left, the bar finished before the move was on
 * screen and `data-nav-pending` was gone while the router already stood on the destination).
 */
export function headingElsewhere(inFlight: readonly string[], origin: string): boolean {
  return inFlight.some((to) => to !== origin);
}

/**
 * What `NavProgress` has seen of the router's screen fetches and commits for the navigation under
 * way. Changed only through the `track*` functions below, so every path is unit-tested.
 */
export type NavTrack = {
  /** The addresses of the counted fetches still in flight (one entry per fetch). */
  inFlight: readonly string[];
  /** A counted fetch has settled since the navigation began. */
  fetched: boolean;
  /** A counted fetch was for another address than the one the navigation started from. */
  elsewhere: boolean;
  /**
   * The router committed a state (Next's own `__NA` history write) after the latest counted fetch
   * went out. A move commits only once its fetch has answered and changes the address as it
   * does; a commit that leaves the address where it was means the router stayed (a redirect
   * back, the view's own address restored) or dropped the move for another one.
   */
  committed: boolean;
  /** The last counted fetch to settle failed (an error or an abort): no commit follows it. */
  failed: boolean;
};

/** Nothing seen yet. */
export const NAV_TRACK_START: NavTrack = {
  inFlight: [],
  fetched: false,
  elsewhere: false,
  committed: false,
  failed: false,
};

/**
 * A navigation begins from `origin`: what it has seen starts again, except the counted fetches
 * still in flight, and a tap's own fetch among them still heads elsewhere (`headingElsewhere`).
 */
export function trackBegin(track: NavTrack, origin: string): NavTrack {
  return {
    inFlight: track.inFlight,
    fetched: false,
    elsewhere: headingElsewhere(track.inFlight, origin),
    committed: false,
    failed: false,
  };
}

/**
 * A counted screen fetch for `to` goes out during a navigation that started from `from`: a move
 * is pending again, so an earlier commit no longer counts.
 */
export function trackFetch(track: NavTrack, to: string, from: string): NavTrack {
  return {
    ...track,
    inFlight: [...track.inFlight, to],
    elsewhere: track.elsewhere || to !== from,
    committed: false,
  };
}

/**
 * A counted fetch for `to` has settled (answered, or `failed`). A commit already seen stays
 * counted: a move the router dropped for another one may still answer after that one committed.
 */
export function trackSettle(track: NavTrack, to: string, failed: boolean): NavTrack {
  const at = track.inFlight.indexOf(to);
  const inFlight = at === -1 ? track.inFlight : track.inFlight.filter((_, index) => index !== at);
  return { ...track, inFlight, fetched: true, failed };
}

/** The router committed a state (Next wrote its own history entry). */
export function trackCommit(track: NavTrack): NavTrack {
  return { ...track, committed: true };
}

/** What `NavProgress` knows about the navigation under way, each frame. */
export type NavMoment = {
  /** The address shown differs from the one the navigation started from. */
  moved: boolean;
  /** A route skeleton (`loading-state`) is still in `main`. */
  skeleton: boolean;
  /** What the router's fetches and commits have shown (`NavTrack`). */
  track: NavTrack;
  /** A page load in full is under way (`beforeunload`): the old page stays until it goes. */
  unloading: boolean;
  /** Ms since the last counted fetch settled (0 when none did). */
  sinceAnswered: number;
  /** Ms since the address changed (0 when it has not). */
  sinceMoved: number;
};

/**
 * Whether the navigation is over and the bar finishes (§14.2 i), whichever comes first:
 *
 * - **the move is on screen:** the address has changed and the new screen is drawn (no skeleton
 *   left, or at most `NAV_SETTLE_MS` after its fetch answered or the address moved);
 * - **a refresh answered:** every counted fetch was for the address it started from;
 * - **the router acted without a move:** every fetch for another address has settled and the
 *   router committed after the latest went out with the address unchanged (a redirect back to
 *   it, the view's own address restored, the move dropped for one back to it), or the last one
 *   failed (an error, an abort) and no page load in full follows it.
 *
 * An answered fetch for another address alone is never the end: the router may still be
 * rendering that screen, and until it commits the address stays where it was, so the bar (and
 * `data-nav-pending`, which every background re-read waits for) stays on (CI run 37781084919).
 */
export function navigationDone(moment: NavMoment): boolean {
  const { moved, skeleton, track, unloading, sinceAnswered, sinceMoved } = moment;
  const idle = track.inFlight.length === 0;
  const answered = track.fetched && idle;
  if (moved) {
    return (
      !skeleton ||
      (answered && sinceAnswered > NAV_SETTLE_MS) ||
      (idle && sinceMoved > NAV_SETTLE_MS)
    );
  }
  if (!answered) return false;
  return !track.elsewhere || track.committed || (track.failed && !unloading);
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

/**
 * Whether a fetch is a server action's call (a POST with `Next-Action`): its answer can carry a
 * new screen for the router, like a refresh.
 */
export function isRouterActionFetch(method: string, headers: Headers): boolean {
  return method.toUpperCase() === "POST" && headers.has("next-action");
}

/**
 * Whether a server action's answer leaves the screen as it is: no redirect (`X-Action-Redirect`)
 * and no revalidation (`X-Action-Revalidated` absent or 0). Next then changes nothing in the
 * router; any other answer re-renders the screen like a refresh does.
 */
export function actionLeavesScreen(headers: Headers): boolean {
  if (headers.has("x-action-redirect")) return false;
  const revalidated = headers.get("x-action-revalidated");
  return revalidated === null || revalidated.trim() === "0";
}
