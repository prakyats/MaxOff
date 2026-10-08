import type { Tables } from "@/core/db";
import { parseReminderRules, type ReminderRule } from "@/core/lib/reminder-rules";
import {
  type ISODate,
  isWeekdayIndex,
  istWeekday,
  WEEK_START_MONDAY,
  type WeekdayIndex,
  WEEKDAY_NAMES,
} from "@/core/time";

/**
 * What the Settings screens work with (PRODUCT §4.16). The rows come from `organizations`,
 * `org_settings` and `holidays`; the shapes below are what the forms render and post back.
 */

export type Company = {
  name: string;
  /** IST everywhere (ADR-0008). Shown, never edited. */
  timezone: string;
  /** The company logo (3.3): an original in `files`; screens show its preview. */
  logoFileId: string | null;
};

export type Thresholds = {
  logoutReminderTime: string;
  /** IST: yesterday's open day can be ended until this time the next morning (3b review). */
  endDayCutoffTime: string;
  ackRepeatHours: number;
  ackEscalateHours: number;
  ackEscalateOwnerHours: number;
  overdueEscalateHours: number;
  emailDailyCapPerMember: number;
  /**
   * The workload warning (kickoff 4 decision 11, WORKFLOWS §3.1): assigning someone who already
   * has this many open tasks due that IST day warns (never blocks). Default 4.
   */
  workloadWarningThreshold: number;
  /**
   * Quiet hours (kickoff 5 decision 5; 5B decision 6, the Owner's editor): IST, for everyone.
   * Push deliveries in the window wait and go out as one summary when it ends; rows and email
   * are not held; "Send a test notification" ignores them. Default 22:00-07:00.
   */
  quietHoursStart: string;
  quietHoursEnd: string;
  /**
   * The organisation's default task reminders (5.3), under every type's and template's. `[]` =
   * "Using the default": the launch schedule (2 days before, 1 day before, when due).
   */
  defaultTaskReminders: ReminderRule[];
  /**
   * The weekday the weekly Owner digest goes (6.5, Kickoff 6 decision 23): 0 = Sunday .. 6 =
   * Saturday, default Monday; at 08:00 IST, or straight after the End-day cutoff saves the last
   * day's report if that is later.
   */
  weeklyDigestDay: WeekdayIndex;
};

/** Kickoff 4 decision 11: four open tasks due the same IST day. */
export const DEFAULT_WORKLOAD_WARNING_THRESHOLD = 4;

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
    endDayCutoffTime: row.end_day_cutoff_time.slice(0, 5),
    ackRepeatHours: row.ack_repeat_hours,
    ackEscalateHours: row.ack_escalate_hours,
    ackEscalateOwnerHours: row.ack_escalate_owner_hours,
    overdueEscalateHours: row.overdue_escalate_hours,
    emailDailyCapPerMember: row.email_daily_cap_per_member,
    // Set to 4 on every row by 4A (default 4); a null would only come from an older row.
    workloadWarningThreshold: row.workload_warning_threshold ?? DEFAULT_WORKLOAD_WARNING_THRESHOLD,
    quietHoursStart: row.quiet_hours_start.slice(0, 5),
    quietHoursEnd: row.quiet_hours_end.slice(0, 5),
    defaultTaskReminders: parseReminderRules(row.default_task_reminders),
    // The column's check keeps it 0..6; a value outside reads as the default, Monday.
    weeklyDigestDay: isWeekdayIndex(row.weekly_digest_day) ? row.weekly_digest_day : 1,
  };
}

/** The weekday choices for the weekly digest, Monday first, with today's setting marked. */
export function weeklyDigestChoices(
  weeklyDigestDay: WeekdayIndex,
): { value: WeekdayIndex; label: string; checked: boolean }[] {
  return WEEK_START_MONDAY.map((day) => ({
    value: day,
    label: WEEKDAY_NAMES[day].long,
    checked: day === weeklyDigestDay,
  }));
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
