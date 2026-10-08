import { formatIST, istDayStart, type ISODate } from "@/core/time";

import type { CalendarDay, EventItem } from "./calendar";

/**
 * What a day's box in the month shows (6.4b; Kickoff 6 decision 25 C, **amended by the owner
 * 2026-10-08**: the box's limited space goes first to what the Owner and Admins act on). At most
 * `MAX_STRIPS` lines, then "+N" for the rest, in this priority:
 * 1. the events: shoots, site visits and meetings (the task type's colour, the title), in the
 *    Owner's order of the types;
 * 2. the tasks: one compact count, red for a past day's open tasks (overdue), else amber "3 due";
 * 3. the holiday: a thin green strip with its name (cut for space, the date number turns green);
 * 4. others' events, an Admin's view (grey, dotted, "Ravi busy", decision 13);
 * 5. leave, last and at most one line a day: a thin low-contrast bar along the bottom of the box,
 *    continuous across consecutive leave days of a week row, with the first name ("Asha") for one
 *    person and "2 off" for several. It is the first thing cut when the box is full, and "+N"
 *    counts it. Who, which type and a half day are in the day's detail only.
 * Strips are never red (the overdue count is a count, not a strip). On a phone's compact month
 * each kind present is one thin bar with no text (`compactBars`). Every label is one line,
 * ellipsised by the view. Pure (ADR-0011): the views draw what this says.
 */

export const MAX_STRIPS = 3;

/** The holiday strip's colour (decision 25: green). */
export const HOLIDAY_COLOR = "#16a34a";

export type Strip =
  | {
      kind: "event";
      key: string;
      /** The title, on a phone. */
      label: string;
      /** "10:00 Brand reel · Client" on a laptop (decision 25 C 2). */
      long: string;
      color: string;
      completed: boolean;
      taskId: string;
    }
  | { kind: "tasks"; key: string; tone: "due" | "overdue"; count: number; label: string }
  | { kind: "holiday"; key: string; label: string }
  | { kind: "busy"; key: string; label: string }
  | {
      kind: "leave";
      key: string;
      /** "Asha" or "2 off": the bar's text. */
      label: string;
      /** "Asha off", "Asha off, half day", "2 off": what a screen reader hears. */
      spoken: string;
      pending: boolean;
    };

export type DayStrips = {
  /** The lines the box shows, in priority order (the leave bar, when shown, is the last). */
  strips: Strip[];
  /** How many were cut for space ("+N"), leave included. */
  more: number;
  /** The day has a holiday its box had no room for: the date number turns green. */
  holidayHidden: boolean;
};

/** An event's place among the strips: its type's rank, then its start (all-day first), then title. */
function eventOrder(a: EventItem, b: EventItem): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.startAt !== b.startAt) {
    if (a.startAt === null) return -1;
    if (b.startAt === null) return 1;
    return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
  }
  return a.title.localeCompare(b.title);
}

/** "10:00 Brand reel · Client", or "Brand reel" for an all-day event with no client. */
export function eventStripText(event: EventItem): string {
  const time = event.startAt ? `${formatIST(event.startAt, "HH:mm")} ` : "";
  const client = event.clientName ? ` · ${event.clientName}` : "";
  return `${time}${event.title}${client}`;
}

/** The first word of a name: "Ravi" for "Ravi Kumar" (strips are narrow). */
function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

export type DueBadge = { tone: "due" | "overdue"; count: number; label: string };

/**
 * The tasks' count: the open tasks due that day, "3 due" in amber; on a past day they are overdue,
 * "1 overdue" in red. Nothing when none is due.
 */
export function dueBadge(day: CalendarDay, today: ISODate): DueBadge | null {
  const count = day.due.length;
  if (count === 0) return null;
  return day.date < today
    ? { tone: "overdue", count, label: `${count} overdue` }
    : { tone: "due", count, label: `${count} due` };
}

/** The day's leave as one line: the first name for one person, "N off" for several. */
export function leaveLine(day: CalendarDay): Extract<Strip, { kind: "leave" }> | null {
  const off = new Map<string, (typeof day.leave)[number]>();
  for (const item of day.leave) if (!off.has(item.memberId)) off.set(item.memberId, item);
  const people = [...off.values()];
  const [only] = people;
  if (!only) return null;
  if (people.length === 1) {
    const who = only.own ? "You" : firstName(only.name);
    return {
      kind: "leave",
      key: "leave",
      label: who,
      spoken: only.half ? `${who} off, half day` : `${who} off`,
      pending: only.pending,
    };
  }
  return {
    kind: "leave",
    key: "leave",
    label: `${people.length} off`,
    spoken: `${people.length} off`,
    pending: people.every((item) => item.pending),
  };
}

/** Every line a day could show, in priority order (before the cut). */
export function allStrips(day: CalendarDay, today: ISODate): Strip[] {
  const strips: Strip[] = [];
  for (const event of [...day.events].sort(eventOrder)) {
    strips.push({
      kind: "event",
      key: `event-${event.id}`,
      label: event.title,
      long: eventStripText(event),
      color: event.color,
      completed: event.completed,
      taskId: event.id,
    });
  }
  const badge = dueBadge(day, today);
  if (badge) strips.push({ kind: "tasks", key: "tasks", ...badge });
  if (day.holiday) strips.push({ kind: "holiday", key: "holiday", label: day.holiday });
  const busy = new Map<string, string>();
  for (const block of day.busy) busy.set(block.memberId, block.name);
  for (const [memberId, name] of busy) {
    strips.push({ kind: "busy", key: `busy-${memberId}`, label: `${firstName(name)} busy` });
  }
  const leave = leaveLine(day);
  if (leave) strips.push(leave);
  return strips;
}

/** The lines a day's box shows: at most `max`, then "+N" for the rest (leave cut first). */
export function dayStrips(day: CalendarDay, today: ISODate, max = MAX_STRIPS): DayStrips {
  const strips = allStrips(day, today);
  const shown = strips.length <= max ? strips : strips.slice(0, max);
  return {
    strips: shown,
    more: strips.length - shown.length,
    holidayHidden: day.holiday !== null && !shown.some((strip) => strip.kind === "holiday"),
  };
}

export type Bar = { kind: "event" | "holiday" | "busy" | "leave"; color: string | null };

/**
 * The compact month's bars (decision 25 A 2): one thin bar per kind present, no text, in the
 * strips' priority (the tasks are the box's dot); an event bar takes the first event's colour.
 * Grey kinds carry no colour.
 */
export function compactBars(day: CalendarDay): Bar[] {
  const bars: Bar[] = [];
  const events = [...day.events].sort(eventOrder);
  if (events[0]) bars.push({ kind: "event", color: events[0].color });
  if (day.holiday) bars.push({ kind: "holiday", color: HOLIDAY_COLOR });
  if (day.busy.length > 0) bars.push({ kind: "busy", color: null });
  if (day.leave.length > 0) bars.push({ kind: "leave", color: null });
  return bars;
}

/** What a day's box says to a screen reader: the date, then each thing on it. */
export function dayLabel(day: CalendarDay, today: ISODate): string {
  const parts = [formatIST(istDayStart(day.date), "EEEE d MMMM")];
  if (day.date === today) parts.push("today");
  if (day.weeklyOff) parts.push("weekly off");
  for (const strip of allStrips(day, today)) {
    if (strip.kind === "leave")
      parts.push(strip.pending ? `${strip.spoken}, requested` : strip.spoken);
    else parts.push(strip.label);
  }
  return parts.join(", ");
}
