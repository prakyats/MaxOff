import { addISTDays, formatIST, istDayStart, type ISODate } from "@/core/time";

import type { LeaveDay } from "./today";

/**
 * "This week" on the Owner's Today (the Today refresh, owner 2026-10-09; ROADMAP 6b.7): the next
 * seven IST days as a few lines. A person's approved leave on consecutive days is one line, "Anna
 * on leave · Mon 12 – Wed 14" (the Owner sees names, as on the calendar); a day with deadlines,
 * events or a holiday is one line, "Thu 15 · 3 due · Shoot 11:00", counted the way the calendar's
 * month view counts them (the caller hands over the calendar's own days, `buildCalendar`). At most
 * `WEEK_LINES` lines, then "See the week". Pure, so it is unit-tested.
 */

/** How many lines show before "See the week". */
export const WEEK_LINES = 5;

/** How many events a day's line names before "+N more" (the line stays one line). */
export const WEEK_EVENTS_NAMED = 2;

/** One day as the calendar's month view has it. */
export type WeekDay = {
  date: ISODate;
  holiday: string | null;
  /** The open tasks due that day that are not events (the calendar's "3 due"). */
  due: number;
  /** The day's events, in the calendar's order. */
  events: readonly { title: string; startAt: string | null }[];
};

/** A line: its words (the first one is the lead, drawn stronger) and the day a tap opens. */
export type WeekLine = {
  kind: "day" | "leave";
  /** The first day the line is about: the calendar opens on it. */
  date: ISODate;
  parts: string[];
  /** A stable key: the day, or the person and their first day. */
  key: string;
};

const LEAVE_PHRASE: Record<"leave" | "half_day" | "comp_leave", string> = {
  leave: "on leave",
  half_day: "on a half day",
  comp_leave: "on comp leave",
};

type LeaveKind = keyof typeof LEAVE_PHRASE;

function leaveKind(value: string | null): LeaveKind | null {
  return value === "leave" || value === "half_day" || value === "comp_leave" ? value : null;
}

/** "Today", "Tomorrow", else "Thu 15" (a week has no room for the month). */
export function shortDay(date: ISODate, today: ISODate): string {
  if (date === today) return "Today";
  if (date === addISTDays(today, 1)) return "Tomorrow";
  return formatIST(istDayStart(date), "EEE d");
}

/** "Mon 12", or "Mon 12 – Wed 14" for a span. */
export function daySpan(from: ISODate, to: ISODate, today: ISODate): string {
  return from === to ? shortDay(from, today) : `${shortDay(from, today)} – ${shortDay(to, today)}`;
}

/** "Shoot 11:00", or "Shoot" for an all-day event (the calendar's 24-hour strip time). */
function eventWords(event: { title: string; startAt: string | null }): string {
  return event.startAt ? `${event.title} ${formatIST(event.startAt, "HH:mm")}` : event.title;
}

/** A day's line, or null when the day holds nothing to say. */
function dayLine(day: WeekDay, today: ISODate): WeekLine | null {
  if (day.holiday === null && day.due === 0 && day.events.length === 0) return null;
  const parts = [shortDay(day.date, today)];
  if (day.holiday !== null) parts.push(`Holiday: ${day.holiday}`);
  if (day.due > 0) parts.push(`${day.due} due`);
  parts.push(...day.events.slice(0, WEEK_EVENTS_NAMED).map(eventWords));
  const more = day.events.length - WEEK_EVENTS_NAMED;
  if (more > 0) parts.push(`+${more} more`);
  return { kind: "day", date: day.date, parts, key: `day-${day.date}` };
}

/**
 * Each person's approved leave (leave, half day, comp leave; never a pending request) in the
 * window, consecutive days of the same kind joined into one span, in date order, then by name.
 */
export function leaveSpans(
  leave: readonly LeaveDay[],
  window: { from: ISODate; to: ISODate },
): { memberId: string; kind: LeaveKind; from: ISODate; to: ISODate }[] {
  const byMember = new Map<string, Map<ISODate, LeaveKind>>();
  for (const row of leave) {
    const kind = leaveKind(row.leave);
    if (!kind || row.day < window.from || row.day > window.to) continue;
    const days = byMember.get(row.memberId) ?? new Map<ISODate, LeaveKind>();
    days.set(row.day, kind);
    byMember.set(row.memberId, days);
  }
  const spans: { memberId: string; kind: LeaveKind; from: ISODate; to: ISODate }[] = [];
  for (const [memberId, days] of byMember) {
    const dates = [...days.keys()].sort();
    let current: (typeof spans)[number] | null = null;
    for (const date of dates) {
      const kind = days.get(date) ?? "leave";
      if (current && current.kind === kind && addISTDays(current.to, 1) === date) {
        current.to = date;
        continue;
      }
      current = { memberId, kind, from: date, to: date };
      spans.push(current);
    }
  }
  return spans;
}

/**
 * The week's lines in date order (on the same day, the day's own line first, then leave by name),
 * the first `WEEK_LINES`, and how many more there are.
 */
export function weekLines(input: {
  days: readonly WeekDay[];
  leave: readonly LeaveDay[];
  nameOf: (memberId: string) => string;
  today: ISODate;
}): { lines: WeekLine[]; hidden: number } {
  const dates = input.days.map((day) => day.date).sort();
  const from = dates[0];
  const to = dates.at(-1);
  if (from === undefined || to === undefined) return { lines: [], hidden: 0 };
  const dayLines = input.days.flatMap((day) => {
    const line = dayLine(day, input.today);
    return line ? [line] : [];
  });
  const leaveLines = leaveSpans(input.leave, { from, to }).map(
    (span): WeekLine & { name: string } => {
      const name = input.nameOf(span.memberId);
      return {
        kind: "leave",
        date: span.from,
        parts: [`${name} ${LEAVE_PHRASE[span.kind]}`, daySpan(span.from, span.to, input.today)],
        key: `leave-${span.memberId}-${span.from}`,
        name,
      };
    },
  );
  const order = (line: WeekLine & { name?: string }) =>
    `${line.date}|${line.kind === "day" ? "0" : "1"}|${line.name ?? ""}|${line.key}`;
  const all = [...dayLines, ...leaveLines]
    .sort((a, b) => order(a).localeCompare(order(b)))
    .map(({ kind, date, parts, key }): WeekLine => ({ kind, date, parts, key }));
  return { lines: all.slice(0, WEEK_LINES), hidden: Math.max(0, all.length - WEEK_LINES) };
}

/** Where a line opens: the calendar on its first day (today: the calendar as it opens). */
export function weekLineHref(line: Pick<WeekLine, "date">, today: ISODate): string {
  return line.date === today ? "/calendar" : `/calendar?date=${line.date}`;
}

/** "See the week": the calendar's week (the laptop's Week view; a phone opens on today). */
export const SEE_THE_WEEK_HREF = "/calendar?view=week";
