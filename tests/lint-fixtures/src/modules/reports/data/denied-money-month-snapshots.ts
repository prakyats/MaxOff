// The snapshot moved from modules/reports to modules/revenue (ADR-0007 amendment 2026-11-25): even a
// data layer of reports may not query it.
export const wrong = `select data from month_snapshots where month = $1`;
