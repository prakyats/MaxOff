import { formatIST } from "@/core/time";

import type { CalendarDay, CalendarView, EventItem } from "./calendar";

/**
 * The laptop calendar's rules (6.4b; Kickoff 6 decision 25 as amended by the owner on
 * 2026-10-08 for the laptop; the phone is unchanged): the day popup's compact agenda, the
 * event blocks' client line, and the keyboard shortcuts. Pure, so each is unit-tested.
 */

/** "11:49–3:49", the agenda's time: "11:49" with no end, "All day" with no start. */
export function agendaTime(startAt: string | null, endAt: string | null): string {
  if (!startAt) return "All day";
  const start = formatIST(startAt, "h:mm");
  return endAt ? `${start}–${formatIST(endAt, "h:mm")}` : start;
}

/** The day's events in time order for the agenda: the all-day ones first, then by start. */
export function agendaEvents(day: Pick<CalendarDay, "events">): EventItem[] {
  return [...day.events].sort((a, b) => {
    if (a.startAt === b.startAt) return a.rank - b.rank || a.title.localeCompare(b.title);
    if (a.startAt === null) return -1;
    if (b.startAt === null) return 1;
    return a.startAt < b.startAt ? -1 : 1;
  });
}

/**
 * Whether a block of this many minutes has room for the client under its title: three lines
 * (title, client, time) need about 52px, and a laptop hour is 48px.
 */
export const CLIENT_LINE_MINUTES = 70;
export function blockShowsClient(minutes: number, clientName: string | null): boolean {
  return clientName !== null && clientName !== "" && minutes >= CLIENT_LINE_MINUTES;
}

export type CalendarShortcut =
  { kind: "move"; direction: -1 | 1 } | { kind: "today" } | { kind: "view"; view: CalendarView };

/** What a key press asks of the laptop calendar, as the browser reports it. */
export type ShortcutKey = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** The key went to a text field, a select or anything editable. */
  inField: boolean;
  /** A dialog, sheet, menu or select list is open. */
  overlayOpen: boolean;
};

/**
 * ← and → move a day, a week or a month (the view's step), T goes to today, D, W and M switch
 * the view. Never with a modifier key, never inside a field, never while an overlay is open.
 */
export function shortcutFor(press: ShortcutKey): CalendarShortcut | null {
  if (press.ctrlKey || press.metaKey || press.altKey || press.shiftKey) return null;
  if (press.inField || press.overlayOpen) return null;
  switch (press.key) {
    case "ArrowLeft":
      return { kind: "move", direction: -1 };
    case "ArrowRight":
      return { kind: "move", direction: 1 };
    case "t":
    case "T":
      return { kind: "today" };
    case "d":
    case "D":
      return { kind: "view", view: "day" };
    case "w":
    case "W":
      return { kind: "view", view: "week" };
    case "m":
    case "M":
      return { kind: "view", view: "month" };
    default:
      return null;
  }
}
