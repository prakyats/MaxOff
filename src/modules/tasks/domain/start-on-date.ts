import { type ISODate, istInstant } from "@/core/time";

/** A day's last minute, IST: the latest deadline a new task on it can have. */
export const LAST_TIME_OF_DAY = "23:59";

/**
 * Whether a calendar day still has a valid deadline for a new task: its last minute (11:59 pm IST)
 * is later than now. Never on a day before today; today only until 11:59 pm IST, after which the
 * form would refuse its own prefill (the same rule as a past day). Its own file, apart from the
 * form's draft logic, so the calendar's first load carries this rule only and not the form
 * (PP-calendar-13; ARCHITECTURE §19).
 */
export function canStartTaskOnDate(date: ISODate, now: Date): boolean {
  return Date.parse(istInstant(date, LAST_TIME_OF_DAY)) > now.getTime();
}
