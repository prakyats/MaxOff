import { formatIST, istDayStart, type ISODate } from "@/core/time";

import type { CalendarDay, EventItem } from "./calendar";

/**
 * What a day's box in the month shows (6.4b; Kickoff 6 decision 25 C): Samsung-style strips, at
 * most `MAX_STRIPS` then "+N", in this priority: the holiday (green, its name) › the events (the
 * task type's colour, the title; shoots and site visits before meetings, as the Owner orders the
 * types) › others' events for an Admin (grey, dotted, "Ravi busy") › leave (grey, "Asha off",
 * "Asha ½", or "2 off"). Due tasks get no strip: a small amber "3 due" in the corner, or a red
 * "1 overdue" on a past day. Strips are never red. On a phone's compact month each kind present
 * is one thin bar with no text (`compactBars`). Pure (ADR-0011): the views draw what this says.
 */

export const MAX_STRIPS = 3;

/** The holiday strip's colour (decision 25: green). */
export const HOLIDAY_COLOR = "#16a34a";

export type Strip =
  | { kind: "holiday"; key: string; label: string }
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
  | { kind: "busy"; key: string; label: string }
  | { kind: "leave"; key: string; label: string; pending: boolean };

export type DayStrips = { strips: Strip[]; more: number };

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

/**
 * Every strip a day could show, in priority order (before the cut): the holiday, the events, one
 * "busy" per other person (an Admin's view, decision 13), then one leave strip.
 */
export function allStrips(day: CalendarDay): Strip[] {
  const strips: Strip[] = [];
  if (day.holiday) strips.push({ kind: "holiday", key: "holiday", label: day.holiday });
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
  const busy = new Map<string, string>();
  for (const block of day.busy) busy.set(block.memberId, block.name);
  for (const [memberId, name] of busy) {
    strips.push({ kind: "busy", key: `busy-${memberId}`, label: `${firstName(name)} busy` });
  }
  const off = new Map<string, (typeof day.leave)[number]>();
  for (const item of day.leave) if (!off.has(item.memberId)) off.set(item.memberId, item);
  const people = [...off.values()];
  if (people.length === 1) {
    const [only] = people;
    if (only) {
      const who = only.own ? "You" : firstName(only.name);
      strips.push({
        kind: "leave",
        key: "leave",
        label: only.half ? `${who} ½` : `${who} off`,
        pending: only.pending,
      });
    }
  } else if (people.length > 1) {
    strips.push({
      kind: "leave",
      key: "leave",
      label: `${people.length} off`,
      pending: people.every((item) => item.pending),
    });
  }
  return strips;
}

/** The strips a day's box shows: at most `max`, then "+N" for the rest. */
export function dayStrips(day: CalendarDay, max = MAX_STRIPS): DayStrips {
  const strips = allStrips(day);
  if (strips.length <= max) return { strips, more: 0 };
  return { strips: strips.slice(0, max), more: strips.length - max };
}

export type DueBadge = { tone: "due" | "overdue"; count: number; label: string };

/**
 * The corner count (decision 25 C): the open tasks due that day, "3 due" in amber; on a past day
 * they are overdue, "1 overdue" in red. Nothing when none is due.
 */
export function dueBadge(day: CalendarDay, today: ISODate): DueBadge | null {
  const count = day.due.length;
  if (count === 0) return null;
  return day.date < today
    ? { tone: "overdue", count, label: `${count} overdue` }
    : { tone: "due", count, label: `${count} due` };
}

export type Bar = { kind: Strip["kind"]; color: string | null };

/**
 * The compact month's bars (decision 25 A 2): one thin bar per kind present, no text, in the
 * strips' priority; an event bar takes the first event's colour. Grey kinds carry no colour.
 */
export function compactBars(day: CalendarDay): Bar[] {
  const bars: Bar[] = [];
  const strips = allStrips(day);
  for (const kind of ["holiday", "event", "busy", "leave"] as const) {
    const first = strips.find((strip) => strip.kind === kind);
    if (!first) continue;
    bars.push({
      kind,
      color: first.kind === "holiday" ? HOLIDAY_COLOR : first.kind === "event" ? first.color : null,
    });
  }
  return bars;
}

/** What a day's box says to a screen reader: the date, then each thing on it, then the count. */
export function dayLabel(day: CalendarDay, today: ISODate): string {
  const parts = [formatIST(istDayStart(day.date), "EEEE d MMMM")];
  if (day.date === today) parts.push("today");
  if (day.weeklyOff) parts.push("weekly off");
  for (const strip of allStrips(day)) {
    parts.push(strip.kind === "leave" && strip.pending ? `${strip.label}, requested` : strip.label);
  }
  const badge = dueBadge(day, today);
  if (badge) parts.push(badge.label);
  return parts.join(", ");
}
