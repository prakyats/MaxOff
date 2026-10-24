/**
 * The laptop columns every deliverable list on the project page shares (6b.11 (6); E+; the
 * approved sample, owner 2026-10-21): deliverable, progress by group, next, planned date, ⋯ and ›, plus the select box in front while Select mode is on. Each row is a subgrid of its list,
 * so the columns line up row to row and the open list and the "Done and closed" group line up.
 * The grid starts at `lg`, where the five columns have room beside the sidebar; below it a row is
 * a card (ARCHITECTURE §14.1). Fluid columns with a floor each, so a 1024 px laptop still fits.
 */
export const DELIVERABLE_COLUMNS =
  "lg:grid lg:grid-cols-[minmax(8rem,1.2fr)_minmax(11rem,2fr)_minmax(8rem,9.5rem)_minmax(6.5rem,8rem)_4.5rem] lg:gap-x-4";

/** The same columns with the select box in front (Select mode, 6b.16 (e)). */
export const DELIVERABLE_COLUMNS_SELECTING =
  "lg:grid lg:grid-cols-[2.75rem_minmax(8rem,1.2fr)_minmax(11rem,2fr)_minmax(8rem,9.5rem)_minmax(6.5rem,8rem)_4.5rem] lg:gap-x-4";

export const deliverableColumns = (selecting: boolean) =>
  selecting ? DELIVERABLE_COLUMNS_SELECTING : DELIVERABLE_COLUMNS;

/**
 * The collapsed row's progress (V3, fixes A and C): chevron, one continuous bar, "n/m", in fixed
 * columns so the bars line up row to row; the loading screen draws the same.
 */
export const PROGRESS_GRID = "grid grid-cols-[1rem_minmax(0,1fr)_3rem] items-center gap-x-2";
