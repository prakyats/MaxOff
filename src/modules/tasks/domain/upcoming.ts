import { bookingTime } from "@/core/lib/booking-words";
import { addISTDays, formatIST, type ISODate, istDayStart } from "@/core/time";

import type { EventTask } from "./dashboards";
import type { TaskListRow } from "./lists";
import { isFinal } from "./task";

/**
 * The Tasks tab's "Upcoming shoots and visits" (v6.5 unit 11; owner 14 Nov 2026, #89 6874350719;
 * the approved sample "3 · Tasks: Upcoming shoots and visits"): the open event tasks the viewer
 * sees whose event is from today to six days ahead (Q2), soonest first, each once (Q3: "Open
 * tasks" and the Crew's Due today / Upcoming leave them out). RLS decides which tasks a viewer
 * gets at all: the Crew only their own. Pure (ADR-0011).
 */

/** Today plus the next six days (Q2). */
export const UPCOMING_EVENT_DAYS = 6;

/** People named on a row before "+2". */
const PEOPLE_NAMED = 2;

export type UpcomingEvent = { row: TaskListRow; event: EventTask };

/** The last day the section looks at. */
export function upcomingEventsUntil(today: ISODate): ISODate {
  return addISTDays(today, UPCOMING_EVENT_DAYS);
}

function startOf(event: EventTask): number {
  return event.eventStartAt ? Date.parse(event.eventStartAt) : Number.NEGATIVE_INFINITY;
}

/**
 * The open event tasks among `rows` (the list's own read, so a row's state and hold are the
 * list's) with an event from `today` to six days ahead: by day, an all-day event before a timed
 * one, then by start and title. A held task stays (its row says "On hold").
 */
export function upcomingEvents(
  events: readonly EventTask[],
  rows: readonly TaskListRow[],
  today: ISODate,
): UpcomingEvent[] {
  const until = upcomingEventsUntil(today);
  const open = new Map(rows.filter((row) => !isFinal(row.state)).map((row) => [row.id, row]));
  return events
    .filter((event) => event.eventDate >= today && event.eventDate <= until)
    .flatMap((event) => {
      const row = open.get(event.id);
      return row ? [{ row, event }] : [];
    })
    .sort(
      (a, b) =>
        a.event.eventDate.localeCompare(b.event.eventDate) ||
        startOf(a.event) - startOf(b.event) ||
        a.row.title.localeCompare(b.row.title),
    );
}

/** The ids the other lists leave out (Q3). */
export function upcomingIds(upcoming: readonly UpcomingEvent[]): Set<string> {
  return new Set(upcoming.map((item) => item.row.id));
}

/** "Mon 16 · 11:00 am – 1:00 pm · Coastal Cafe", "Tue 17 · All day": the row's first line. */
export function upcomingWhen(event: EventTask): string {
  const day = formatIST(istDayStart(event.eventDate), "EEE d");
  const time = bookingTime({ startAt: event.eventStartAt, endAt: event.eventEndAt });
  const place = event.location?.trim();
  return [day, time, place].filter(Boolean).join(" · ");
}

/**
 * "PShetty, Kiran +2": the people on it, the primary owner first, the viewer as `nameOf` says
 * ("you"); null with nobody on it.
 */
export function upcomingPeople(event: EventTask, nameOf: (id: string) => string): string | null {
  if (event.assigneeIds.length === 0) return null;
  const ids = [...event.assigneeIds].sort(
    (a, b) => Number(b === event.primaryOwnerId) - Number(a === event.primaryOwnerId),
  );
  const named = ids.slice(0, PEOPLE_NAMED).map(nameOf).join(", ");
  const more = ids.length - PEOPLE_NAMED;
  return more > 0 ? `${named} +${more}` : named;
}
