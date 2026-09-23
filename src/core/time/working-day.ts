import { type ISODate, isISODate } from "./ist";

/**
 * Working days (ADR-0008, WORKFLOWS §1): a date is a working day unless its weekday is one of
 * the company's weekly off days or it is a holiday. The mirror of `app.is_working_day()`, kept
 * pure so screens and the attendance logic of phase 2 can answer without a round trip. The
 * database stays the source of truth: pass it the settings you read.
 */

/** 0 = Sunday … 6 = Saturday, as `org_settings.weekly_off_days` stores them. */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_INDEXES: readonly WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];

/** Monday first: how a week reads on a calendar here, with Sunday (the usual off day) last. */
export const WEEK_START_MONDAY: readonly WeekdayIndex[] = [1, 2, 3, 4, 5, 6, 0];

export const WEEKDAY_NAMES: Record<WeekdayIndex, { long: string; short: string }> = {
  0: { long: "Sunday", short: "Sun" },
  1: { long: "Monday", short: "Mon" },
  2: { long: "Tuesday", short: "Tue" },
  3: { long: "Wednesday", short: "Wed" },
  4: { long: "Thursday", short: "Thu" },
  5: { long: "Friday", short: "Fri" },
  6: { long: "Saturday", short: "Sat" },
};

export function isWeekdayIndex(value: number): value is WeekdayIndex {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

/**
 * The weekday of a business date. The date is a calendar day, not an instant, so it is read at
 * UTC midnight: no timezone can shift it (`2026-09-20` is a Sunday everywhere).
 */
export function istWeekday(date: ISODate): WeekdayIndex {
  if (!isISODate(date)) throw new RangeError(`Invalid ISO date: ${date}`);
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (!isWeekdayIndex(day)) throw new RangeError(`Invalid weekday: ${day}`);
  return day;
}

export type WorkingDayRules = {
  /** `org_settings.weekly_off_days`. */
  weeklyOffDays: readonly number[];
  /** The dates in `holidays`. A Set or an array both work. */
  holidays?: Iterable<ISODate> | undefined;
};

/** False on a weekly off day or a holiday, true otherwise (`app.is_working_day()`). */
export function isWorkingDay(date: ISODate, rules: WorkingDayRules): boolean {
  const weekday = istWeekday(date);
  if (rules.weeklyOffDays.includes(weekday)) return false;
  for (const holiday of rules.holidays ?? []) {
    if (holiday === date) return false;
  }
  return true;
}
