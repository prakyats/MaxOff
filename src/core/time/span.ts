/**
 * How long something has been (or will be), as people say it (B10, UX review 2026-10-21: past
 * 24 hours say days, "overdue 1 day", never "overdue by 33 h"). One rule for every list:
 * minutes under an hour, hours under a day, then days, each rounded as people say it (2 h 50 min
 * is "3 h", 33 h is "1 day").
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "25 min", "3 h", "1 day", "4 days" for a span in milliseconds (never under 1 min). */
export function spanWords(ms: number): string {
  const span = Math.max(0, ms);
  const minutes = Math.max(1, Math.round(span / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(span / HOUR);
  if (hours < 24) return `${hours} h`;
  const days = Math.max(1, Math.round(span / DAY));
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * "3 h late", "2 days late": how late a task is, `ms` past its deadline, as a chip says it (the
 * Owner's Today risks, and every task row's late chip since PP-tasks-2).
 */
export function lateWords(ms: number): string {
  return `${spanWords(ms)} late`;
}

/** "overdue 3 h", "overdue 1 day": how late something is, `ms` past its deadline. */
export function overdueWords(ms: number): string {
  return `overdue ${spanWords(ms)}`;
}
