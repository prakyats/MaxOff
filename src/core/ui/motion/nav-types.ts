/**
 * The drill-down slide (ARCHITECTURE §14.2 j, task 2.7b). A navigation slides only when it moves
 * through the drill-down hierarchy: `nav-forward` into a detail (`DrillLink`, `OverlayLink`),
 * `nav-back` out of it (`BackLink`). Tabs, view controls, refreshes and the system back gesture
 * carry no type, and no type means no animation.
 */
export const NAV_FORWARD = "nav-forward";
export const NAV_BACK = "nav-back";

/** Phone width: below Tailwind's `md`, where the bottom bar is the navigation. */
export const PHONE_QUERY = "(width < 48rem)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether a typed navigation slides (owner decision 2026-09-25): the installed app at phone
 * width, never with reduced motion. A browser tab and the desktop, installed or not, behave like
 * a website and do not slide.
 */
export function slideAllowed(standalone: boolean, phone: boolean, reduced: boolean): boolean {
  return standalone && phone && !reduced;
}
