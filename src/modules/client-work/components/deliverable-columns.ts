/**
 * The desktop columns every deliverable list on the project page shares (6b.11 (6)): select,
 * deliverable, stages, planned date, action. Each row is a subgrid of its list, so the stage
 * chips sit in one column and the open list and the "Done and closed" group line up. On a phone
 * a row is a card (ARCHITECTURE §14.1).
 */
export const DELIVERABLE_COLUMNS =
  "md:grid md:grid-cols-[2.75rem_minmax(0,1fr)_minmax(0,1.5fr)_11rem_7.5rem] md:gap-x-3";
