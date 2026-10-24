import { addISTDays, type ISODate, toISTDate } from "@/core/time";

import { clockWord, dayWord } from "./days";
import type { LeaveDay } from "./today";

/**
 * "This week" on the Owner's Today (the Today refresh, owner 2026-10-09; ROADMAP 6b.7), in the
 * **detailed layout** (the owner's final note, 2026-10-09): a block per day that has something
 * ("Today", "Tomorrow", "Wed 14 Oct"), its rows listed under it, each a time on the left ("All
 * day", "11:49 am") and words on the right:
 *
 * - a holiday ("All day" · "Holiday: Diwali");
 * - a person's approved leave on consecutive days, **one row** in the block of its first day
 *   ("All day" · "Prakyat on leave", "Prakyat on leave · until Thu 15"; the block's heading
 *   already names the first day, PP-today-4; the Owner sees names, as on the calendar; the
 *   reader's own reads "You're on leave");
 * - each event task by its time and title (and its place), opening the task (the calendar's
 *   order: all-day first, then by time);
 * - each of the day's other deadlines **by name** ("6:00 pm" · "Test 4", a "Due" chip; PP-today-4),
 *   opening the task, by time.
 *
 * Days with nothing are left out. At most `WEEK_DAYS_SHOWN` days and `WEEK_ROWS_SHOWN` rows, then
 * "See the week" (the calendar's week). Pure, so it is unit-tested; the caller hands over the
 * calendar's own days (`buildCalendar`).
 */

/** At most this many day blocks show before "See the week". */
export const WEEK_DAYS_SHOWN = 5;

/** At most this many rows show, across the blocks, before "See the week". */
export const WEEK_ROWS_SHOWN = 8;

/** One day as the calendar's month view has it. */
export type WeekDay = {
  date: ISODate;
  holiday: string | null;
  /** The open tasks due that day that are not events (the calendar's "3 due"), each by name. */
  due: readonly { id: string; title: string; dueAt: string }[];
  /** The day's event tasks, in the calendar's order (all-day first, then by time). */
  events: readonly { id: string; title: string; startAt: string | null; detail?: string | null }[];
};

/** A row: the time column, the words, where a tap goes, and what it is. */
export type WeekRow = {
  kind: "holiday" | "leave" | "event" | "due";
  /** "All day", "11:49 am", "6:00 pm". */
  when: string;
  title: string;
  /** A second, muted line: an event's place, whose it is. */
  detail?: string | null;
  href: string;
  key: string;
};

/** A day's block: its word and its rows. */
export type WeekBlock = { date: ISODate; label: string; rows: WeekRow[] };

const LEAVE_PHRASE: Record<"leave" | "half_day" | "comp_leave", string> = {
  leave: "on leave",
  half_day: "on a half day",
  comp_leave: "on comp leave",
};

type LeaveKind = keyof typeof LEAVE_PHRASE;

function leaveKind(value: string | null): LeaveKind | null {
  return value === "leave" || value === "half_day" || value === "comp_leave" ? value : null;
}

/** "Today", "Tomorrow", else "Thu 15" (a span's ends: the month is in the block's heading). */
export function shortDay(date: ISODate, today: ISODate): string {
  const word = dayWord(date, today);
  return word === "Today" || word === "Tomorrow" ? word : word.replace(/ [A-Z][a-z]{2}$/, "");
}

/** "", or " · until Wed 14" for a span (its block's heading names the first day, PP-today-4). */
export function spanTail(from: ISODate, to: ISODate, today: ISODate): string {
  return from === to ? "" : ` · until ${shortDay(to, today)}`;
}

/** "Mon 12", or "Mon 12 – Wed 14" for a span. */
export function daySpan(from: ISODate, to: ISODate, today: ISODate): string {
  return from === to ? shortDay(from, today) : `${shortDay(from, today)} – ${shortDay(to, today)}`;
}

/** Where a day opens: the calendar on that day (today: the calendar as it opens). */
export function dayHref(date: ISODate, today: ISODate): string {
  return date === today ? "/calendar" : `/calendar?date=${date}`;
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

/** A day's rows: the holiday, the leave starting that day (by name), the events, the deadlines. */
function dayRows(day: WeekDay, leave: readonly WeekRow[], today: ISODate): WeekRow[] {
  const rows: WeekRow[] = [];
  if (day.holiday !== null) {
    rows.push({
      kind: "holiday",
      when: "All day",
      title: `Holiday: ${day.holiday}`,
      href: dayHref(day.date, today),
      key: `holiday-${day.date}`,
    });
  }
  rows.push(...leave);
  for (const event of day.events) {
    rows.push({
      kind: "event",
      when: event.startAt ? clockWord(event.startAt) : "All day",
      title: event.title,
      detail: event.detail ?? null,
      href: `/tasks/${event.id}`,
      key: `event-${event.id}`,
    });
  }
  const due = [...day.due].sort(
    (a, b) => a.dueAt.localeCompare(b.dueAt) || a.title.localeCompare(b.title),
  );
  for (const task of due) {
    rows.push({
      kind: "due",
      when: clockWord(task.dueAt),
      title: task.title,
      href: `/tasks/${task.id}`,
      key: `due-${task.id}`,
    });
  }
  return rows;
}

/**
 * The week's blocks in date order, cut to `WEEK_DAYS_SHOWN` days and `WEEK_ROWS_SHOWN` rows (a
 * day's rows are cut too when the rows run out; the first day always shows), and how many rows
 * were left out (then "See the week").
 */
export function weekBlocks(input: {
  days: readonly WeekDay[];
  leave: readonly LeaveDay[];
  nameOf: (memberId: string) => string;
  today: ISODate;
  /** The reader: their own leave reads "You're on leave". */
  selfId?: string;
}): { blocks: WeekBlock[]; hidden: number } {
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  const from = days[0]?.date;
  const to = days.at(-1)?.date;
  if (from === undefined || to === undefined) return { blocks: [], hidden: 0 };
  const leaveByDay = new Map<ISODate, WeekRow[]>();
  const spans = leaveSpans(input.leave, { from, to })
    .map((span) => ({ ...span, name: input.nameOf(span.memberId) }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
  for (const span of spans) {
    const rows = leaveByDay.get(span.from) ?? [];
    rows.push({
      kind: "leave",
      when: "All day",
      title: `${span.memberId === input.selfId ? "You're" : span.name} ${LEAVE_PHRASE[span.kind]}${spanTail(span.from, span.to, input.today)}`,
      href: dayHref(span.from, input.today),
      key: `leave-${span.memberId}-${span.from}`,
    });
    leaveByDay.set(span.from, rows);
  }
  const all = days.flatMap((day): WeekBlock[] => {
    const rows = dayRows(day, leaveByDay.get(day.date) ?? [], input.today);
    return rows.length > 0 ? [{ date: day.date, label: dayWord(day.date, input.today), rows }] : [];
  });
  const total = all.reduce((sum, block) => sum + block.rows.length, 0);
  const blocks: WeekBlock[] = [];
  let left = WEEK_ROWS_SHOWN;
  for (const block of all) {
    if (blocks.length === WEEK_DAYS_SHOWN || left === 0) break;
    const rows = block.rows.slice(0, left);
    left -= rows.length;
    blocks.push({ ...block, rows });
  }
  const shown = blocks.reduce((sum, block) => sum + block.rows.length, 0);
  return { blocks, hidden: total - shown };
}

/** "See the week": the calendar's week (the laptop's Week view; a phone opens on today). */
export const SEE_THE_WEEK_HREF = "/calendar?view=week";

/**
 * The week's days for a reader's own "This week" (My Day, an Admin's Today; FINAL 8): the
 * holidays, their event tasks (all-day first, then by time) and the deadlines of their other open
 * tasks, by name, each on its IST day in [from, to]. An event task is never listed as due too.
 * Their own leave goes in `weekBlocks`' `leave`. Pure (`week.test.ts`).
 */
export function ownWeekDays(input: {
  from: ISODate;
  to: ISODate;
  holidays: readonly { date: ISODate; name: string }[];
  events: readonly {
    id: string;
    title: string;
    eventDate: ISODate;
    eventStartAt: string | null;
    detail?: string | null;
  }[];
  due: readonly { id: string; title: string; dueAt: string }[];
}): WeekDay[] {
  const eventIds = new Set(input.events.map((event) => event.id));
  const days: WeekDay[] = [];
  for (let date = input.from; date <= input.to; date = addISTDays(date, 1)) {
    const events = input.events
      .filter((event) => event.eventDate === date)
      .sort(
        (a, b) =>
          (a.eventStartAt ?? "").localeCompare(b.eventStartAt ?? "") ||
          a.title.localeCompare(b.title),
      )
      .map((event) => ({
        id: event.id,
        title: event.title,
        startAt: event.eventStartAt,
        detail: event.detail ?? null,
      }));
    days.push({
      date,
      holiday: input.holidays.find((holiday) => holiday.date === date)?.name ?? null,
      events,
      due: input.due.filter((task) => !eventIds.has(task.id) && toISTDate(task.dueAt) === date),
    });
  }
  return days;
}

/** A reader's own approved leave requests as `weekBlocks`' days (each day in [from, to]). */
export function ownLeaveDays(
  memberId: string,
  spans: readonly { type: string; startDate: string; endDate: string }[],
  window: { from: ISODate; to: ISODate },
): LeaveDay[] {
  const days: LeaveDay[] = [];
  for (const span of spans) {
    const first = span.startDate > window.from ? span.startDate : window.from;
    const last = span.endDate < window.to ? span.endDate : window.to;
    for (let day = first; day <= last; day = addISTDays(day, 1)) {
      days.push({ memberId, day, leave: span.type });
    }
  }
  return days;
}
