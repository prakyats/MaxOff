/**
 * Whether the app prefetches ahead of a tap (P2 item 6, ARCHITECTURE §19 "Prefetch the likely
 * next screen"). Pure, so it is unit-tested; `useLessData` / `lessDataNow` apply it.
 *
 * Every `Link` prefetches its destination's **loading boundary** in view and on a touch (Next's
 * `auto`), and the shell prefetches every tab (`usePrefetchTabs`): never the page's data. With
 * **data saver** on (`navigator.connection.saveData`) nothing is asked ahead of time: no row
 * (`DrillLink`) and no tab prefetch; the tap fetches.
 */

/** The part of `navigator.connection` (Network Information API, Chromium only) read here. */
export interface ConnectionHint {
  saveData?: boolean;
}

/** True when the person asked their browser to save data. An unknown connection never does. */
export function wantsLessData(connection: ConnectionHint | null | undefined): boolean {
  return connection?.saveData === true;
}
