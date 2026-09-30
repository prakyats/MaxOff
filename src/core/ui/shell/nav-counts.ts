import type { NavBadges } from "./nav";

/** No counts: what the bars show when the counts could not be read. */
export const NO_BADGES: NavBadges = {};

/**
 * The viewer's nav counts, never failing (4C review S3). The `(app)` layout streams them into
 * every bar (`NavCount`, ARCHITECTURE §19) under a layout-level `<Suspense>` with no error
 * boundary of its own, so one refused or unreachable count read used to reach the app's error
 * screen and blank every role's shell. A failed read is `report`ed and the bars show no count:
 * a count is a hint, the screens behind it still read their own data. Kept out of `nav.ts`,
 * which client components import, so the shell's JavaScript does not carry it.
 */
export function countsOrNone(
  counts: Promise<NavBadges>,
  report: (error: unknown) => void,
): Promise<NavBadges> {
  return counts.catch((error: unknown) => {
    report(error);
    return NO_BADGES;
  });
}
