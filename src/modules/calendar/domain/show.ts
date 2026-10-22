import type { CalendarDay, CalendarScope, ClientItemEntry } from "./calendar";

/**
 * The calendar's **All · Tasks · Client work** switch (SCOPE §6, the approved calendar sample):
 * the Owner's and Admins' (Crew never see client work, so their calendar has no switch). A view
 * control: it changes what the days show, never the address or the history (ARCHITECTURE §14.2),
 * and each device remembers its choice. Leave, holidays and the weekly off always show. Pure
 * (ADR-0011): the screen applies what this says.
 */

export const CALENDAR_SHOWS = ["all", "tasks", "client"] as const;
export type CalendarShow = (typeof CALENDAR_SHOWS)[number];

export const SHOW_LABELS: Record<CalendarShow, string> = {
  all: "All",
  tasks: "Tasks",
  client: "Client work",
};

/** The device's remembered choice (`localStorage`). */
export const SHOW_STORAGE_KEY = "maxoff.calendar.show";

/** A stored value read back: anything unknown is "all". */
export function parseShow(value: string | null | undefined): CalendarShow {
  return (CALENDAR_SHOWS as readonly string[]).includes(value ?? "")
    ? (value as CalendarShow)
    : "all";
}

/** Whether a role gets the switch: the Owner and Admins, never Crew. */
export function showsSwitch(scope: CalendarScope): boolean {
  return scope !== "staff";
}

/**
 * A day as the switch shows it: "Tasks" hides the client work, "Client work" hides the tasks
 * (events, others' busy times and what is due); leave, the holiday and the weekly off stay.
 */
export function shownDay(day: CalendarDay, show: CalendarShow): CalendarDay {
  if (show === "tasks") return day.items.length === 0 ? day : { ...day, items: [] };
  if (show === "client") return { ...day, events: [], busy: [], due: [] };
  return day;
}

/**
 * The day popup's "Client work · n" (SCOPE §6): grouped by client (the clients in name order, the
 * open work before the done within each, then by title), so one client's work sits together.
 */
export function clientWorkRows(items: readonly ClientItemEntry[]): ClientItemEntry[] {
  return [...items].sort(
    (a, b) =>
      a.client.localeCompare(b.client) ||
      Number(a.done) - Number(b.done) ||
      a.title.localeCompare(b.title),
  );
}
