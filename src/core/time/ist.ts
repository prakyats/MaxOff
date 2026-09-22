import { isValid, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * IST helpers (ADR-0008). This file is the only place in `src/` that formats or
 * computes business dates, and the only place allowed to call `new Date()` for
 * "now" (the lint rule `no-restricted-syntax` enforces that outside `core/time`).
 *
 * Mirrors the SQL helpers `app.today_ist()` / `app.to_ist_date()`.
 */

export const IST_TIMEZONE = "Asia/Kolkata";

/** A calendar date as `YYYY-MM-DD` (what Postgres `date` columns serialize to). */
export type ISODate = string;

/** Anything that names an instant: a Date, epoch milliseconds or an ISO 8601 string WITH a time. */
export type Instant = Date | number | string;

/** Returns the current instant. Injected so tests never depend on the wall clock. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar-only arithmetic happens at UTC midnight, where no DST can shift a day. */
function calendarDate(date: ISODate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function toDate(instant: Instant): Date {
  if (typeof instant === "string" && ISO_DATE.test(instant)) {
    // A bare date (what a Postgres `date` column serialises to) has no instant: parsing
    // it would pick the host's midnight, which differs per machine. Callers keep it as ISODate.
    throw new RangeError(
      `"${instant}" is a date, not an instant; pass a time or use it as ISODate`,
    );
  }
  const date = typeof instant === "string" ? parseISO(instant) : new Date(instant);
  if (!isValid(date)) {
    throw new RangeError(`Invalid instant: ${String(instant)}`);
  }
  return date;
}

/** The IST business date of an instant. `18:30:00Z` is already the next day. */
export function toISTDate(instant: Instant): ISODate {
  return formatInTimeZone(toDate(instant), IST_TIMEZONE, "yyyy-MM-dd");
}

/** Today's IST business date. Pass a clock in tests. */
export function todayIST(clock: Clock = systemClock): ISODate {
  return toISTDate(clock());
}

/** True for a well-formed, real calendar date such as `2026-09-21`. */
export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = calendarDate(value);
  return isValid(parsed) && parsed.toISOString().slice(0, 10) === value;
}

function assertISODate(date: ISODate): void {
  if (!isISODate(date)) throw new RangeError(`Invalid ISO date: ${date}`);
}

/** The instant at which an IST business date starts (00:00 IST = 18:30 UTC the day before). */
export function istDayStart(date: ISODate): Date {
  assertISODate(date);
  return fromZonedTime(`${date}T00:00:00`, IST_TIMEZONE);
}

/**
 * The half-open range `[start, end)` covering an IST business date, as UTC instants.
 * Use it for "rows created today IST" queries: `created_at >= start and created_at < end`.
 */
export function istDayRange(date: ISODate): { start: Date; end: Date } {
  const start = istDayStart(date);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Adds (or subtracts) whole days to an ISO date without any timezone drift. */
export function addISTDays(date: ISODate, days: number): ISODate {
  assertISODate(date);
  return new Date(calendarDate(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Formats an instant in IST with a date-fns pattern. Default: `21 Sep 2026, 6:05 pm`. */
export function formatIST(instant: Instant, pattern = "d MMM yyyy, h:mm aaa"): string {
  return formatInTimeZone(toDate(instant), IST_TIMEZONE, pattern);
}
