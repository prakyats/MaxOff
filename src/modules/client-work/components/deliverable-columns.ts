/**
 * The laptop columns every deliverable list on the project page shares (6b.11 (6); E+, the owner's
 * feedback of 2026-10-16): deliverable, progress (one bar, V3), next, planned date,
 * action, plus the select box in front while Select mode is on. Each row is a subgrid of its list,
 * so the columns line up row to row and the open list and the "Done and closed" group line up.
 * The grid starts at `lg`, where the five columns have room beside the sidebar; below it a row is
 * a card (ARCHITECTURE §14.1). Fluid columns with a floor each, so a 1024 px laptop still fits.
 */
export const DELIVERABLE_COLUMNS =
  "lg:grid lg:grid-cols-[minmax(8rem,1.5fr)_minmax(9rem,1fr)_minmax(8rem,1.3fr)_minmax(6.5rem,0.6fr)_8rem] lg:gap-x-3";

/** The same columns with the select box in front (Select mode, 6b.16 (e)). */
export const DELIVERABLE_COLUMNS_SELECTING =
  "lg:grid lg:grid-cols-[2.75rem_minmax(8rem,1.5fr)_minmax(9rem,1fr)_minmax(8rem,1.3fr)_minmax(6.5rem,0.6fr)_8rem] lg:gap-x-3";

export const deliverableColumns = (selecting: boolean) =>
  selecting ? DELIVERABLE_COLUMNS_SELECTING : DELIVERABLE_COLUMNS;

/**
 * The collapsed row's progress (V3, fixes A and C): chevron, one continuous bar, "n/m", in fixed
 * columns so the bars line up row to row; the loading screen draws the same.
 */
export const PROGRESS_GRID = "grid grid-cols-[1rem_minmax(0,1fr)_3rem] items-center gap-x-2";
