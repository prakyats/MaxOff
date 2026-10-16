/**
 * The laptop columns every deliverable list on the project page shares (6b.11 (6); E+, the owner's
 * feedback of 2026-10-16): deliverable, progress (one strip per stage group), next, planned date,
 * action, plus the select box in front while Select mode is on. Each row is a subgrid of its list,
 * so the columns line up row to row and the open list and the "Done and closed" group line up.
 * The grid starts at `lg`, where the five columns have room beside the sidebar; below it a row is
 * a card (ARCHITECTURE §14.1). Fluid columns with a floor each, so a 1024 px laptop still fits.
 */
export const DELIVERABLE_COLUMNS =
  "lg:grid lg:grid-cols-[minmax(8rem,1.6fr)_minmax(11rem,1.2fr)_minmax(6.5rem,0.8fr)_minmax(6.5rem,0.7fr)_7rem] lg:gap-x-3";

/** The same columns with the select box in front (Select mode, 6b.16 (e)). */
export const DELIVERABLE_COLUMNS_SELECTING =
  "lg:grid lg:grid-cols-[2.75rem_minmax(8rem,1.6fr)_minmax(11rem,1.2fr)_minmax(6.5rem,0.8fr)_minmax(6.5rem,0.7fr)_7rem] lg:gap-x-3";

export const deliverableColumns = (selecting: boolean) =>
  selecting ? DELIVERABLE_COLUMNS_SELECTING : DELIVERABLE_COLUMNS;

/**
 * A stage group's strip (E+): chevron, label, bar, count, in fixed columns so the bars line up from
 * strip to strip and row to row; the loading screen draws the same.
 */
export const STRIP_GRID =
  "grid grid-cols-[1rem_minmax(0,7rem)_minmax(0,1fr)_2.75rem] items-center gap-x-1.5 lg:grid-cols-[1rem_minmax(0,5rem)_minmax(0,1fr)_2.5rem]";
