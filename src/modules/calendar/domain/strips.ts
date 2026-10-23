import { formatIST, formatTime, type ISODate, istDayStart } from "@/core/time";

import { dueCount, type CalendarDay, type EventItem } from "./calendar";

/**
 * What a day's box in the month shows (6.4b; Kickoff 6 decision 25 C, **amended by the owner
 * 2026-10-08**: the box's limited space goes first to what the Owner and Admins act on). At most
 * `MAX_STRIPS` lines; a day with more keeps one line fewer and ends in "+N more" (PP-calendar-14:
 * the box never grows or clips; the line opens the day like the rest of the box), in this priority:
 * 1. the events: shoots, site visits and meetings (the task type's colour, the title), in the
 *    Owner's order of the types;
 * 2. what is due, each a named chip (PP-calendar-5, V5b: "Test 4", not "1 due"): red for a past
 *    day's open tasks (overdue), else amber, its type's colour on the edge;
 * 2b. client work (SCOPE §6, the approved calendar sample): each open deliverable an outlined chip,
 *    the client first ("Shetty · Reel 1"), red outlined when late;
 * 3. the holiday: a thin green strip with its name (cut for space, the date number turns green);
 * 4. others' events, an Admin's view (grey, dotted, "Ravi busy", decision 13);
 * 5. leave, last and at most one line a day: a bar in the leave tone along the bottom of the box,
 *    continuous across consecutive leave days of a week row, "Asha · On leave" for one person and
 *    "2 on leave" for several (PP-calendar-3, V5b). It is the first thing cut when the box is full,
 *    and "+N" counts it. Who, which type and a half day are in the day's detail only.
 * Only an overdue chip is red. On a phone's compact month
 * each kind present is one thin bar with no text (`compactBars`). Every label is one line,
 * ellipsised by the view. Pure (ADR-0011): the views draw what this says.
 */

export const MAX_STRIPS = 3;

/** The holiday strip's colour (decision 25: green): the `--holiday` token, both themes (DESIGN.md §4). */
export const HOLIDAY_COLOR = "var(--holiday)";

export type Strip =
  | {
      kind: "event";
      key: string;
      /** The title, on a phone. */
      label: string;
      /** "Brand reel · 10:00 am · Client" on a laptop (decision 25 C 2; title first, PP-calendar-2). */
      long: string;
      color: string;
      completed: boolean;
      taskId: string;
    }
  | {
      kind: "due";
      key: string;
      /** The task's or the deliverable's title. */
      label: string;
      tone: "due" | "overdue";
      /** The task type's colour; null for a deliverable (no type: the tone's colour). */
      color: string | null;
    }
  | {
      /**
       * A client deliverable (SCOPE §6, the approved calendar sample): an outlined chip with the
       * box icon, the client first, "Shetty · Reel 1"; red outlined when late (its planned day is
       * past and it is still open).
       */
      kind: "item";
      key: string;
      /** "Shetty · Reel 1": the client first. */
      label: string;
      client: string;
      title: string;
      late: boolean;
    }
  | { kind: "holiday"; key: string; label: string }
  | { kind: "busy"; key: string; label: string }
  | {
      kind: "leave";
      key: string;
      /** "Asha · On leave" or "2 on leave": the bar's text. */
      label: string;
      /**
       * "Asha · Leave": the laptop bar's wording where "On leave" has no room (v1.8, owner 23 Oct:
       * a leave bar never truncates); "2 on leave" stays as it is.
       */
      short: string;
      /**
       * One person's photo for the laptop bar's last wording, `[photo] Leave`, where even "Asha ·
       * Leave" has no room (owner 23 Oct); null for several people ("2 on leave" stays).
       */
      person: { id: string; name: string; avatarFileId: string | null } | null;
      /**
       * "Asha, on leave", "Asha, on leave, half day", "2 on leave": what a screen reader hears,
       * the first name always in full, whichever wording the bar shows.
       */
      spoken: string;
      pending: boolean;
    };

export type DayStrips = {
  /** The lines the box shows, in priority order (the leave bar, when shown, is the last). */
  strips: Strip[];
  /** How many were cut for space ("+N more", its own last line), leave included. */
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

/**
 * "Brand reel · 10:00 am · Client", or "Brand reel" for an all-day event with no client: the title
 * first, never the time alone (PP-calendar-2, V5b).
 */
export function eventStripText(event: EventItem): string {
  const time = event.startAt ? ` · ${formatTime(event.startAt)}` : "";
  const client = event.clientName ? ` · ${event.clientName}` : "";
  return `${event.title}${time}${client}`;
}

/** The first word of a name: "Ravi" for "Ravi Kumar" (strips are narrow). */
function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

export type DueBadge = {
  tone: "due" | "overdue";
  count: number;
  label: string;
};

/**
 * The count of what is due that day (the open tasks and deliverables), "3 due"; on a past day they
 * are overdue, "1 overdue". The phone's compact dot and what a day's box says to a screen reader;
 * the boxes themselves name each one. Nothing when none is due.
 */
export function dueBadge(day: CalendarDay, today: ISODate): DueBadge | null {
  // Client items join the count (kickoff 7 decision 21).
  const count = dueCount(day);
  if (count === 0) return null;
  return day.date < today
    ? { tone: "overdue", count, label: `${count} overdue` }
    : { tone: "due", count, label: `${count} due` };
}

/** The day's leave as one line: "Asha · On leave" for one person, "N on leave" for several. */
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
      label: `${who} · On leave`,
      short: `${who} · Leave`,
      person: { id: only.memberId, name: only.name, avatarFileId: only.avatarFileId ?? null },
      spoken: only.half ? `${who}, on leave, half day` : `${who}, on leave`,
      pending: only.pending,
    };
  }
  return {
    kind: "leave",
    key: "leave",
    label: `${people.length} on leave`,
    short: `${people.length} on leave`,
    person: null,
    spoken: `${people.length} on leave`,
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
  const tone = day.date < today ? "overdue" : "due";
  for (const due of day.due) {
    strips.push({ kind: "due", key: `due-${due.id}`, label: due.title, tone, color: due.color });
  }
  // Client work after the tasks (SCOPE §6: timed tasks, due tasks, client work, "+N more").
  for (const item of day.items) {
    if (item.done) continue;
    strips.push({
      kind: "item",
      key: `item-${item.id}`,
      label: `${item.client} · ${item.title}`,
      client: item.client,
      title: item.title,
      late: day.date < today,
    });
  }
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

/**
 * The lines a day's box shows: all of them when they fit in `max`, else `max - 1` and a "+N more"
 * line for the rest, the line counted in `max` (PP-calendar-14; leave cut first).
 */
export function dayStrips(day: CalendarDay, today: ISODate, max = MAX_STRIPS): DayStrips {
  const strips = allStrips(day, today);
  const shown = strips.length <= max ? strips : strips.slice(0, max - 1);
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
  // What is due is said once, as the count ("2 due"; the day's dialog names them).
  const badge = dueBadge(day, today);
  let dueSaid = false;
  for (const strip of allStrips(day, today)) {
    if (strip.kind === "due" || strip.kind === "item") {
      if (!dueSaid && badge) parts.push(badge.label);
      dueSaid = true;
    } else if (strip.kind === "leave")
      parts.push(strip.pending ? `${strip.spoken}, requested` : strip.spoken);
    else parts.push(strip.label);
  }
  return parts.join(", ");
}
