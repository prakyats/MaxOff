/**
 * Pull-to-refresh, built into MaxOff (ARCHITECTURE §14.2 i, owner decision 2026-09-28; it
 * reverses the 2.7 "off" but not its reason). The browser's own pull stays off
 * (`overscroll-behavior`), because it reloads the whole app and loses what the person was doing;
 * this one re-fetches the screen's data in place with `router.refresh()`: no reload, no splash,
 * open sheets, typed text and scroll stay. The rules, apart from the gesture's plumbing:
 */

/** How far (CSS px, after resistance) a pull must travel before release refreshes. */
export const PULL_TRIGGER_PX = 64;
/** The indicator never travels further than this. */
export const PULL_MAX_PX = 96;
/** A finger moves twice as far as the indicator: a pull that feels deliberate. */
export const PULL_RESISTANCE = 0.5;
/** Repeated pulls within this window are ignored: the data cannot have moved much. */
export const PULL_THROTTLE_MS = 5_000;

/** How far the indicator has travelled for a finger that has moved `dy` px down. */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(PULL_MAX_PX, dy * PULL_RESISTANCE);
}

/**
 * Tab roots where the pull is off: the calendar's own vertical swipe grows and shrinks it
 * (Kickoff 6 decision 25 A, 6.4b), so a downward drag there is the calendar's. The screen keeps
 * refresh on return and Realtime.
 */
export const NO_PULL_ROOTS: readonly string[] = ["/calendar"];

/**
 * Whether a pull may start here and now. Only on a tab's first screen (a top-level destination:
 * the same list the bar and `tab-history` use; never the calendar's, `NO_PULL_ROOTS`), scrolled to the very top, with no overlay open
 * (a sheet or dialog owns the gesture), no record in edit mode (typed text is never re-read
 * under the person), no approval inside its Undo window (the refresh-on-return guard: the list
 * would come back before the send has left), and not again within the throttle.
 */
export function canPull({
  pathname,
  tabRoots,
  scrollY,
  overlayOpen,
  editing,
  sendWaiting,
  now,
  lastPull,
}: {
  pathname: string;
  tabRoots: readonly string[];
  scrollY: number;
  overlayOpen: boolean;
  editing: boolean;
  sendWaiting: boolean;
  now: number;
  lastPull: number;
}): boolean {
  return (
    tabRoots.includes(pathname) &&
    !NO_PULL_ROOTS.includes(pathname) &&
    scrollY <= 0 &&
    !overlayOpen &&
    !editing &&
    !sendWaiting &&
    now - lastPull >= PULL_THROTTLE_MS
  );
}
