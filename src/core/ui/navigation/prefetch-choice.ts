/**
 * Which prefetch a link makes (P2 item 6, ARCHITECTURE §19 "Prefetch the likely next screen").
 * Pure, so the choice is unit-tested; `useLessData` and `DrillLink` apply it.
 *
 * Every `Link` already prefetches its destination's **loading boundary** when it comes into view
 * and again on a touch (Next's `auto`), never the page's data: counted at the e2e server's
 * Supabase proxy, the prefetch of a tab (Tasks, Approvals…) reads only the viewer's member row
 * (its loading screen is shaped by the role). A **client's or a person's page** is the
 * exception: its layout reads the record for the header (the name, the state), so each of those
 * rows in view cost the server 4 to 6 database requests on every open of the list, and again
 * every time the router drops its prefetches (refresh on return, every action). On the Free-plan
 * database that was close to half of a list's cost, for pages nobody opened.
 *
 * So a row of such a list says where it stands (`rank`, 0 = the first row shown):
 * - the **first few** keep the in-view prefetch: they are where the finger goes first, and their
 *   tap shows the traced skeleton at once;
 * - **the rest prefetch on intent**: the finger (or the mouse button) going down, or a mouse
 *   resting on it, asks for the same loading-boundary prefetch, a moment before the tap's own
 *   request;
 * - **data saver** (`navigator.connection.saveData`) asks for nothing extra: no in-view and no
 *   intent prefetch from these rows, and no ahead-of-time prefetch of the tabs; the tap fetches.
 *
 * Nothing here adds a request kind: each is the router's own `auto` prefetch (`staleTimes`
 * `static`, a skeleton), so a tap never shows data older than the freshness rule (§19, 6b.17a):
 * the data on screen always comes from the tap's own request.
 */

/** How many of a list's first rows prefetch while in view (a phone shows 6 to 8 cards). */
export const PREFETCH_FIRST_ROWS = 4;

export type RowPrefetch = "viewport" | "intent" | "none";

/** The prefetch of the row at `rank` (0-based, in the order shown). */
export function rowPrefetch(
  rank: number,
  lessData: boolean,
  first: number = PREFETCH_FIRST_ROWS,
): RowPrefetch {
  if (lessData) return "none";
  return rank >= 0 && rank < first ? "viewport" : "intent";
}

/** The part of `navigator.connection` (Network Information API, Chromium only) read here. */
export interface ConnectionHint {
  saveData?: boolean;
}

/** True when the person asked their browser to save data. An unknown connection never does. */
export function wantsLessData(connection: ConnectionHint | null | undefined): boolean {
  return connection?.saveData === true;
}

/** What an intent is: the primary button or a finger going down, or a mouse coming to rest. */
export function isIntent(
  event: { type: string; pointerType: string; button: number; isPrimary: boolean },
  lessData: boolean,
): boolean {
  if (lessData || !event.isPrimary) return false;
  if (event.type === "pointerenter") return event.pointerType === "mouse";
  return event.type === "pointerdown" && event.button === 0;
}
