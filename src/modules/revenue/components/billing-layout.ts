/**
 * The Billing section's boxes, shared by the section and its skeleton so the skeleton traces it
 * (ARCHITECTURE §14.1): the card, a 64 px row (a small label over its value, the control beside
 * them: 44 px on a phone, 32 px on a laptop), and the cycle's three figures.
 */
export const BILLING_SECTION = "flex min-w-0 flex-col gap-2";
export const BILLING_CARD =
  "border-border bg-card shadow-raised divide-border divide-y overflow-hidden rounded-lg border text-sm";
export const BILLING_ROW = "flex min-h-16 items-center gap-3 px-4 py-2";
export const BILLING_ROW_TEXT = "flex min-w-0 flex-1 flex-col gap-0.5";
export const BILLING_FIGURES = "flex flex-col gap-2 px-4 py-3";
export const BILLING_FIGURES_GRID = "grid grid-cols-3 gap-3";
export const BILLING_FIGURE = "flex min-w-0 flex-col gap-0.5";
/**
 * v2.5: a collapsed part of the section (Planned deliverables, Billing history): a `<details>`
 * whose summary is one 64 px row (its name over a short line, the chevron beside them), so the
 * skeleton draws the same row and nothing moves; opening it is a view control (no history).
 */
export const BILLING_DISCLOSURE = "group/billing-part";
export const BILLING_SUMMARY =
  "flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-2 outline-none select-none focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset active:bg-muted/60 [&::-webkit-details-marker]:hidden";
export const BILLING_CHEVRON =
  "text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-open/billing-part:rotate-90 motion-reduce:transition-none";
