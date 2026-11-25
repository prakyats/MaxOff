/**
 * The close screen's boxes (v3.5 U4), shared by the screen and its skeleton so the skeleton traces
 * it (ARCHITECTURE §14.1): the month's line, then one section (its heading over a card of
 * two-line rows). Every state of the screen (waiting, closed, cannot close, error) starts with the
 * same two boxes, so nothing moves whichever one arrives.
 */
export const CLOSE_PAGE = "flex min-w-0 flex-col gap-4";
/** The month's own line: "September 2026". */
export const CLOSE_MONTH = "flex min-h-11 items-center";
export const CLOSE_SECTION = "flex min-w-0 flex-col gap-2";
/** A section's heading line (`text-sm`, one line box). */
export const CLOSE_HEADING = "flex min-h-5 items-center text-sm font-medium";
export const CLOSE_CARD =
  "border-border bg-card shadow-raised divide-border divide-y overflow-hidden rounded-lg border text-sm";
/** One row: two lines of text beside a count or a figure. */
export const CLOSE_ROW = "flex min-h-16 items-center gap-3 px-4 py-2";
export const CLOSE_ROW_TEXT = "flex min-w-0 flex-1 flex-col gap-0.5";
export const CLOSE_ROW_END = "flex shrink-0 flex-col items-end gap-0.5 text-right";
/** A plain line under a card ("Expense claims … until 5 Oct."). */
export const CLOSE_NOTE = "text-muted-foreground text-sm break-words";
