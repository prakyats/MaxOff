import { formatIST, toISTDate, type ISODate } from "@/core/time";

import type { AvailabilitySource, CalendarScope, EventSource, LeaveSource } from "./calendar";

/**
 * "Who's free" in a day's detail (6.4b; Kickoff 6 decision 25 D), for the Owner and Admins only:
 * "Free: … · Busy 10–1: … · On leave: …" over the people they can see (`team.view`: every active
 * member but the Owner, freelancers included and named as such). Built from what the viewer may
 * already read, never more (decision 13): the Owner every event task and everyone's approved leave;
 * an Admin their own events and leave in full and everyone else through `member_availability()`
 * (busy blocks and the fact of leave; a date-only event of someone else is not in it, so it does
 * not make them busy, 6B later item (c)). A pending leave request is not leave yet. Pure.
 */

export type FreePerson = { id: string; name: string };

export type WhoFree = {
  free: string[];
  /** Grouped by the same busy time: "10–1", "10–11, 2–3", "all day". */
  busy: { when: string; names: string[] }[];
  /** "Asha", "Ravi (½)". */
  onLeave: string[];
};

type Block = { startAt: string | null; endAt: string | null };

/** "10", "10:30": an hour, its minutes only when they are not on the hour (12-hour clock). */
function clock(instant: string): string {
  return formatIST(instant, "mm") === "00" ? formatIST(instant, "h") : formatIST(instant, "h:mm");
}

/** "10–1" for a block, "all day" with no start; an end defaults to an hour after the start. */
export function busyWindow(block: Block): string {
  if (!block.startAt) return "all day";
  const end = block.endAt ?? new Date(new Date(block.startAt).getTime() + 3_600_000).toISOString();
  return `${clock(block.startAt)}–${clock(end)}`;
}

function windows(blocks: readonly Block[]): string {
  if (blocks.some((block) => !block.startAt)) return "all day";
  return [...blocks]
    .sort((a, b) => new Date(a.startAt ?? 0).getTime() - new Date(b.startAt ?? 0).getTime())
    .map(busyWindow)
    .filter((text, index, all) => all.indexOf(text) === index)
    .join(", ");
}

export function whoIsFree(input: {
  date: ISODate;
  scope: CalendarScope;
  viewerId: string;
  people: readonly FreePerson[];
  events: readonly EventSource[];
  /** Leave the viewer reads in full: everyone's for the Owner, their own for an Admin. */
  leave: readonly LeaveSource[];
  /** An Admin's `member_availability()` rows; null for the Owner. */
  availability: readonly AvailabilitySource[] | null;
}): WhoFree | null {
  if (input.scope === "staff") return null;
  const seen = new Set(input.people.map((person) => person.id));
  const blocks = new Map<string, Block[]>();
  const add = (memberId: string, block: Block) => {
    if (!seen.has(memberId)) return;
    blocks.set(memberId, [...(blocks.get(memberId) ?? []), block]);
  };
  for (const event of input.events) {
    if (event.eventDate !== input.date || event.state === "cancelled") continue;
    for (const memberId of event.assigneeIds) {
      // An Admin's others come from availability (the same blocks, with the date-only ones the
      // Admin can see on their own tasks added below).
      if (input.scope === "admin" && memberId !== input.viewerId && event.eventStartAt) continue;
      add(memberId, { startAt: event.eventStartAt, endAt: event.eventEndAt });
    }
  }
  const leave = new Map<string, boolean>();
  for (const span of input.leave) {
    if (span.pending || span.startDate > input.date || span.endDate < input.date) continue;
    if (input.scope === "admin" && span.memberId !== input.viewerId) continue;
    leave.set(span.memberId, span.type === "half_day");
  }
  if (input.scope === "admin" && input.availability) {
    for (const row of input.availability) {
      if (row.day !== input.date || row.memberId === input.viewerId) continue;
      if (row.leave === "leave" || row.leave === "comp_leave") leave.set(row.memberId, false);
      else if (row.leave === "half_day") leave.set(row.memberId, true);
      for (const block of row.blocks) {
        if (block.startAt && toISTDate(block.startAt) === input.date) add(row.memberId, block);
      }
    }
  }

  const byName = (a: FreePerson, b: FreePerson) => a.name.localeCompare(b.name);
  const people = [...input.people].sort(byName);
  const free: string[] = [];
  const onLeave: string[] = [];
  const busy = new Map<string, string[]>();
  for (const person of people) {
    const half = leave.get(person.id);
    if (half === false) {
      onLeave.push(person.name);
      continue;
    }
    if (half === true) onLeave.push(`${person.name} (½)`);
    const own = blocks.get(person.id);
    if (own && own.length > 0) {
      const when = windows(own);
      busy.set(when, [...(busy.get(when) ?? []), person.name]);
    } else if (half !== true) {
      free.push(person.name);
    }
  }
  return {
    free,
    busy: [...busy.entries()].map(([when, names]) => ({ when, names })),
    onLeave,
  };
}

/**
 * "Who's free: Asha, Ravi · Busy 10–1: Kiran · On leave: Meera (½)" (the owner's preview review,
 * 2026-10-08: no repeated "Free"); "Busy …" and "On leave …" only when there are any; "nobody"
 * when everyone is busy or away.
 */
export function whoFreeLine(who: WhoFree): string {
  const parts = [`Who's free: ${who.free.length > 0 ? who.free.join(", ") : "nobody"}`];
  for (const group of who.busy) parts.push(`Busy ${group.when}: ${group.names.join(", ")}`);
  if (who.onLeave.length > 0) parts.push(`On leave: ${who.onLeave.join(", ")}`);
  return parts.join(" · ");
}
