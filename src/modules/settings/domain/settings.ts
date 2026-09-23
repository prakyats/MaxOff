import type { Tables } from "@/core/db";
import { type ISODate, istWeekday, WEEK_START_MONDAY, WEEKDAY_NAMES } from "@/core/time";

/**
 * What the Settings screens work with (PRODUCT §4.16). The rows come from `organizations`,
 * `org_settings` and `holidays`; the shapes below are what the forms render and post back.
 */

export type Company = {
  name: string;
  /** IST everywhere (ADR-0008). Shown, never edited. */
  timezone: string;
};

export type Thresholds = {
  logoutReminderTime: string;
  ackRepeatHours: number;
  ackEscalateHours: number;
  ackEscalateOwnerHours: number;
  overdueEscalateHours: number;
  emailDailyCapPerMember: number;
};

export type OrgSettings = Thresholds & {
  weeklyOffDays: number[];
};

export type Holiday = {
  id: string;
  date: ISODate;
  name: string;
};

export function toOrgSettings(row: Tables<"org_settings">): OrgSettings {
  return {
    weeklyOffDays: [...row.weekly_off_days].sort((a, b) => a - b),
    // Postgres serialises `time` as HH:MM:SS; the form's input wants HH:MM.
    logoutReminderTime: row.logout_reminder_time.slice(0, 5),
    ackRepeatHours: row.ack_repeat_hours,
    ackEscalateHours: row.ack_escalate_hours,
    ackEscalateOwnerHours: row.ack_escalate_owner_hours,
    overdueEscalateHours: row.overdue_escalate_hours,
    emailDailyCapPerMember: row.email_daily_cap_per_member,
  };
}

/** The weekly-off checkboxes, Monday first, with today's setting applied. */
export function weeklyOffChoices(
  weeklyOffDays: readonly number[],
): { value: number; label: string; short: string; checked: boolean }[] {
  return WEEK_START_MONDAY.map((day) => ({
    value: day,
    label: WEEKDAY_NAMES[day].long,
    short: WEEKDAY_NAMES[day].short,
    checked: weeklyOffDays.includes(day),
  }));
}

/** "Sunday", "Saturday and Sunday", "None" — the summary under the section heading. */
export function describeWeeklyOff(weeklyOffDays: readonly number[]): string {
  const names = WEEK_START_MONDAY.filter((day) => weeklyOffDays.includes(day)).map(
    (day) => WEEKDAY_NAMES[day].long,
  );
  if (names.length === 0) return "None";
  if (names.length === 1) return names[0] ?? "None";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export type HolidayYear = { year: string; holidays: (Holiday & { weekday: string })[] };

/**
 * Holidays grouped by calendar year, each year and each list in date order, with the weekday
 * named: "is that a Sunday anyway?" is the first thing anyone asks of a holiday list.
 */
export function holidaysByYear(holidays: readonly Holiday[]): HolidayYear[] {
  const years = new Map<string, (Holiday & { weekday: string })[]>();
  for (const holiday of [...holidays].sort((a, b) => a.date.localeCompare(b.date))) {
    const year = holiday.date.slice(0, 4);
    const entries = years.get(year) ?? [];
    entries.push({ ...holiday, weekday: WEEKDAY_NAMES[istWeekday(holiday.date)].long });
    years.set(year, entries);
  }
  return [...years.entries()].map(([year, entries]) => ({ year, holidays: entries }));
}

/** Only dates that are still ahead matter for planning; past ones stay for the record. */
export function isUpcoming(holiday: Holiday, today: ISODate): boolean {
  return holiday.date >= today;
}
