/**
 * The Billing history's paging (v2.5, Q7), apart from its wording so the screen's client part
 * carries no formatter: the first look is the newest 20, each "Show older" asks for 20 more, and
 * the function answers at most 200.
 */
export const HISTORY_PAGE = 20;
export const HISTORY_MAX = 200;

/** The next page's size for "Show older": 20 more, never past the function's 200. */
export function nextHistoryLimit(limit: number): number {
  return Math.min(limit + HISTORY_PAGE, HISTORY_MAX);
}

/** Whether older rows may exist: the read filled the page it asked for, under the cap. */
export function mayHaveOlder(rowCount: number, limit: number): boolean {
  return rowCount >= limit && limit < HISTORY_MAX;
}
