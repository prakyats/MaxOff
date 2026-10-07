import { addISTDays, toISTDate, type ISODate } from "@/core/time";

import { inlineDay } from "./days";

/**
 * Crew's My Day under the attendance strip (6.1; Kickoff 6 decisions 1–3, 22; PRODUCT §4.7).
 * The exception rows come from the Tasks tab's own groups (`myTaskGroups`); this file adds what
 * My Day says on its own: the one Upcoming line, the events, and the one quiet line for a holiday
 * or the person's own approved leave.
 */

/** How far ahead My Day looks: the Upcoming line, the events' "this week", the quiet line. */
export const MY_DAY_AHEAD_DAYS = 7;

/** The exception sections, in the Tasks tab's order (Kickoff 4 decision 25); never counts. */
export const MY_DAY_GROUPS = ["not_noted", "changes_requested", "overdue", "due_today"] as const;
export type MyDayGroup = (typeof MY_DAY_GROUPS)[number];

/** My Day's empty state when no exception row is waiting (decision 22). */
export const MY_DAY_EMPTY = "Nothing needs you today.";

/**
 * "N more in the next 7 days" (decision 1): the upcoming tasks (the Tasks tab's Upcoming group,
 * already past the exception groups) due within the next seven IST days.
 */
export function upcomingWithin(
  upcoming: readonly { dueAt: string }[],
  today: ISODate,
  days = MY_DAY_AHEAD_DAYS,
): number {
  const last = addISTDays(today, days);
  return upcoming.filter((task) => toISTDate(task.dueAt) <= last).length;
}

export function upcomingLine(count: number): string {
  return count === 1 ? "1 more in the next 7 days" : `${count} more in the next 7 days`;
}

/** An event task as My Day and Today read it. */
export type DayEvent = {
  id: string;
  title: string;
  eventDate: ISODate;
  eventStartAt: string | null;
  location: string | null;
  assigneeIds: readonly string[];
};

/**
 * My Day's events (decision 2): the person's own event tasks (and their coordinated freelancers',
 * "for Asha", as My Day's rows are) today and tomorrow as rows, then how many more fall in the
 * rest of the next seven days ("N more this week", opening the Calendar). Never anyone else's.
 */
export function myDayEvents<T extends DayEvent>(
  events: readonly T[],
  own: (event: T) => boolean,
  today: ISODate,
): { rows: T[]; moreThisWeek: number } {
  const tomorrow = addISTDays(today, 1);
  const last = addISTDays(today, MY_DAY_AHEAD_DAYS - 1);
  const mine = byStart(events.filter(own));
  return {
    rows: mine.filter((event) => event.eventDate === today || event.eventDate === tomorrow),
    moreThisWeek: mine.filter((event) => event.eventDate > tomorrow && event.eventDate <= last)
      .length,
  };
}

export function moreThisWeekLine(count: number): string {
  return count === 1 ? "1 more this week" : `${count} more this week`;
}

/** By day, then start time (an event with no time first in its day), then title. */
export function byStart<T extends DayEvent>(events: readonly T[]): T[] {
  return [...events].sort(
    (a, b) =>
      a.eventDate.localeCompare(b.eventDate) ||
      (a.eventStartAt ?? "").localeCompare(b.eventStartAt ?? "") ||
      a.title.localeCompare(b.title),
  );
}

export type QuietLeave = {
  type: "leave" | "half_day" | "comp_leave";
  startDate: string;
  endDate: string;
};

const LEAVE_WORDS: Record<QuietLeave["type"], string> = {
  leave: "leave",
  half_day: "half day",
  comp_leave: "comp leave",
};

/**
 * The one quiet line (decision 2): the first holiday or stretch of the person's own approved
 * leave in the next seven days, whichever comes first ("Holiday Thu 12 Nov: Diwali", "Your leave
 * Mon 9 Nov – Wed 11 Nov"). Null when there is neither.
 */
export function quietLine(input: {
  holidays: readonly { date: ISODate; name: string }[];
  leave: readonly QuietLeave[];
  today: ISODate;
}): string | null {
  const { today } = input;
  const last = addISTDays(today, MY_DAY_AHEAD_DAYS - 1);
  const holiday = input.holidays
    .filter((h) => h.date >= today && h.date <= last)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const leave = input.leave
    .filter((l) => l.endDate >= today && l.startDate <= last)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const leaveFrom = leave ? (leave.startDate < today ? today : (leave.startDate as ISODate)) : null;
  if (holiday && (!leave || !leaveFrom || holiday.date <= leaveFrom)) {
    return `Holiday ${inlineDay(holiday.date, today)}: ${holiday.name}`;
  }
  if (leave && leaveFrom) {
    const to = leave.endDate as ISODate;
    const span =
      to === leaveFrom
        ? inlineDay(leaveFrom, today)
        : `${inlineDay(leaveFrom, today)} – ${inlineDay(to, today)}`;
    return `Your ${LEAVE_WORDS[leave.type]} ${span}`;
  }
  return null;
}
