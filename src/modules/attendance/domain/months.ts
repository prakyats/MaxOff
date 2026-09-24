import { addISTDays, formatIST, istDayStart } from "@/core/time";

/** An IST calendar month, `yyyy-MM`: the unit the attendance history pages by. */
export type Month = string;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is Month {
  return typeof value === "string" && MONTH.test(value);
}

/** The month an IST date falls in. */
export function monthOf(date: string): Month {
  return date.slice(0, 7);
}

/** `n` months later (or earlier, for a negative `n`). */
export function addMonths(month: Month, n: number): Month {
  const [year, index] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n];
  const y = year + Math.floor(index / 12);
  const m = ((index % 12) + 12) % 12;
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`;
}

/** First and last IST date of the month, both inclusive. */
export function monthRange(month: Month): { first: string; last: string } {
  return { first: `${month}-01`, last: addISTDays(`${addMonths(month, 1)}-01`, -1) };
}

/** "September 2026". */
export function monthLabel(month: Month): string {
  return formatIST(istDayStart(`${month}-01`), "MMMM yyyy");
}

/**
 * The month to show and where the pager may go: the one asked for, held between the member's
 * first month and the current one (owner decision 2026-09-24: since joining, one IST month at
 * a time). Anything unreadable falls back to the current month.
 */
export function historyMonth(
  requested: unknown,
  bounds: { first: Month; current: Month },
): { month: Month; previous: Month | null; next: Month | null } {
  const first = bounds.first <= bounds.current ? bounds.first : bounds.current;
  let month = isMonth(requested) ? requested : bounds.current;
  if (month < first) month = first;
  if (month > bounds.current) month = bounds.current;
  return {
    month,
    previous: month > first ? addMonths(month, -1) : null,
    next: month < bounds.current ? addMonths(month, 1) : null,
  };
}
