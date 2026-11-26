/**
 * The Revenue page's boxes, shared by the page and its skeleton so the skeleton traces it
 * (ARCHITECTURE §14.1): the month row, the category filter (two by two on a phone, one row on a
 * laptop), the month's three figures, and a client's card with its lines.
 */
export const REVENUE_PAGE = "flex min-w-0 flex-col gap-4";
export const REVENUE_PAGER = "flex min-h-11 items-center justify-between gap-2";
export const REVENUE_FILTER =
  "bg-muted grid grid-cols-2 gap-1 rounded-lg p-1 md:inline-grid md:w-[32rem] md:grid-cols-4";
export const REVENUE_FILTER_CELL =
  "flex min-h-11 items-center justify-center rounded-md px-2 text-center text-sm font-medium";
export const REVENUE_CARD =
  "border-border bg-card shadow-raised divide-border divide-y overflow-hidden rounded-lg border text-sm";
export const REVENUE_FIGURES = "grid grid-cols-3 gap-3 px-4 py-3";
export const REVENUE_FIGURE = "flex min-w-0 flex-col gap-0.5";
export const REVENUE_SECTION = "flex min-w-0 flex-col gap-2";
/** A client's own line: its name over Potential · Achieved · Remaining. */
export const REVENUE_CLIENT_HEAD = "flex min-h-16 flex-col justify-center gap-0.5 px-4 py-2";
/** One line (a cycle or a one-time project): two lines of text beside its figure. */
export const REVENUE_LINE = "flex min-h-16 items-center gap-3 px-4 py-2";
export const REVENUE_LINE_TEXT = "flex min-w-0 flex-1 flex-col gap-0.5";
export const REVENUE_LINE_FIGURE = "flex shrink-0 flex-col items-end gap-0.5 text-right";
