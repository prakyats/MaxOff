import { bookedByWord, bookingTime } from "@/core/lib/booking-words";
import { formatDateTime, formatIST, formatTime, type ISODate } from "@/core/time";

import {
  type AvailabilityDay,
  blockClashes,
  type CurrentAssignment,
  type EventBlock,
  type EventWindow,
  type LeaveMark,
  withoutOwnBlock,
} from "./warnings";

/**
 * "Who's on it?" (v6.0 "Admin calendar", owner-approved samples 13 and 14 Nov 2026): the task
 * form's people picker, a clearer view of the availability the warnings are already computed from
 * (`member_availability()`, WORKFLOWS §3.1 "Assignment warnings"), never a new rule.
 *
 * - **An event** (a day, with or without a time): **Free then** and **Busy then**. Busy is a
 *   booking that clashes (the same rule as the overlap warning: a date-only event on either side
 *   clashes with everything that day), said as on the calendar, "Shoot 2:00 pm – 4:00 pm · booked
 *   by Nikhil Rao" with a "Clashes" chip, and a full day of leave ("On leave", no reason and no
 *   type). A half day has no morning or afternoon, so the person stays under Free then with "Half
 *   day that day"; a pending request stays there too with "Leave requested". A booking that day
 *   that does not clash is said under Free: "Free · earlier: Meeting 11:00 am – 1:00 pm · booked
 *   by Owner".
 * - **A deadline only**: one list, each person with that day's lines (their bookings, leave, how
 *   many tasks are already due), no groups and no Clashes chip.
 *
 * Never a title, a client or a location of someone else's task: the data holds none. Editing, the
 * task's own booking and its own count are no line against itself. Pure (ADR-0011).
 */

export type PickerPerson = { id: string; name: string };

export type PickerChip = "clashes" | "on_leave";

export const PICKER_CHIP_LABELS: Record<PickerChip, string> = {
  clashes: "Clashes",
  on_leave: "On leave",
};

export type PickerRow = {
  memberId: string;
  name: string;
  /** The status under the name, a line each; none while their day is not known. */
  lines: string[];
  chips: PickerChip[];
  /** The word beside the person's chip in the form: "Free", "Clashes", "On leave"; "" for none. */
  short: string;
};

/** What the people are picked for: an event's day and window, or a deadline's day. */
export type PickerWhen =
  | { kind: "event"; date: ISODate; window: EventWindow | null }
  | { kind: "deadline"; date: ISODate };

export type PickerList =
  | { kind: "event"; free: PickerRow[]; busy: PickerRow[] }
  /** A deadline only: one list. Also everyone, with no line, while no day is known. */
  | { kind: "day"; rows: PickerRow[] };

export type PickerInput = {
  /** In the order they are listed (by name). */
  people: readonly PickerPerson[];
  /** Null until the form has a day. */
  when: PickerWhen | null;
  /** Everyone's rows for the day; null while they are read, or when the read failed. */
  availability: readonly AvailabilityDay[] | null;
  viewerId: string;
  /** The organisation's Owner, so a booking says "booked by Owner". */
  ownerId: string | null;
  /** The task as it stands, when editing. */
  current?: CurrentAssignment | undefined;
};

/** "Shoot 2:00 pm – 4:00 pm · booked by Nikhil Rao"; "Shoot all day · booked by you". */
export function bookingLine(block: EventBlock, viewerId: string, ownerId: string | null): string {
  const time = block.startAt ? bookingTime(block) : "all day";
  const by = bookedByWord(
    { id: block.bookedById ?? null, name: block.bookedByName ?? null },
    viewerId,
    ownerId,
  );
  return `${block.typeName?.trim() || "Event"} ${time}${by ? ` · booked by ${by}` : ""}`;
}

/** The line of a person with nothing at the task's time, the one line the list draws in green. */
export const FREE_LINE = "Free";

const FULL_LEAVE: readonly LeaveMark[] = ["leave", "comp_leave"];

/** A leave mark that leaves the person pickable as free: a half day, or a request not decided. */
function softLeaveWords(leave: LeaveMark | null): string | null {
  if (leave === "half_day") return "Half day that day";
  if (leave === "requested") return "Leave requested";
  return null;
}

function eventRow(
  person: PickerPerson,
  row: AvailabilityDay,
  window: EventWindow | null,
  own: { window: EventWindow | null } | null,
  input: PickerInput,
): { group: "free" | "busy"; row: PickerRow } {
  const blocks = withoutOwnBlock(row.eventBlocks, own);
  const clashes = blocks.filter((block) => blockClashes(block, window));
  const onLeave = row.leave !== null && FULL_LEAVE.includes(row.leave);
  const say = (block: EventBlock) => bookingLine(block, input.viewerId, input.ownerId);

  if (clashes.length > 0 || onLeave) {
    const chips: PickerChip[] = [
      ...(clashes.length > 0 ? (["clashes"] as const) : []),
      ...(onLeave ? (["on_leave"] as const) : []),
    ];
    return {
      group: "busy",
      row: {
        memberId: person.id,
        name: person.name,
        lines: clashes.length > 0 ? clashes.map(say) : ["On leave that day"],
        chips,
        short: chips.map((chip) => PICKER_CHIP_LABELS[chip]).join(" · "),
      },
    };
  }

  // Free then. What else they have that day is said, so a tight day is not a surprise.
  const head = softLeaveWords(row.leave) ?? FREE_LINE;
  const others = blocks.map((block) => {
    const earlier =
      window !== null &&
      block.endAt !== null &&
      Date.parse(block.endAt) <= Date.parse(window.startAt);
    return `${earlier ? "earlier" : "later"}: ${say(block)}`;
  });
  const [first, ...rest] = others;
  return {
    group: "free",
    row: {
      memberId: person.id,
      name: person.name,
      lines: [first ? `${head} · ${first}` : head, ...rest.map(capitalise)],
      chips: [],
      short: head === "Half day that day" ? "Half day" : head,
    },
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dayRow(
  person: PickerPerson,
  row: AvailabilityDay,
  own: { window: EventWindow | null } | null,
  ownCount: number,
  input: PickerInput,
): PickerRow {
  const lines = withoutOwnBlock(row.eventBlocks, own).map((block) =>
    bookingLine(block, input.viewerId, input.ownerId),
  );
  if (row.leave !== null && FULL_LEAVE.includes(row.leave)) lines.push("On leave that day");
  const soft = softLeaveWords(row.leave);
  if (soft) lines.push(soft);
  const due = Math.max(0, row.openTasksDue - ownCount);
  if (due > 0) lines.push(`${due} ${due === 1 ? "task" : "tasks"} already due`);
  return {
    memberId: person.id,
    name: person.name,
    lines: lines.length > 0 ? lines : ["Nothing that day"],
    chips: [],
    short: "",
  };
}

/** The picker's rows: the people in their order, grouped for an event. */
export function pickerList(input: PickerInput): PickerList {
  const { when, availability, current } = input;
  const unknown = (person: PickerPerson): PickerRow => ({
    memberId: person.id,
    name: person.name,
    lines: [],
    chips: [],
    short: "",
  });
  if (!when || !availability) return { kind: "day", rows: input.people.map(unknown) };

  const rows = new Map<string, AvailabilityDay>();
  for (const row of availability) if (row.day === when.date) rows.set(row.memberId, row);
  const wasOn = (id: string) => current?.open === true && current.memberIds.includes(id);
  const ownBlock = (id: string) =>
    current && wasOn(id) && current.eventDate === when.date
      ? { window: current.eventWindow }
      : null;

  if (when.kind === "deadline") {
    return {
      kind: "day",
      rows: input.people.map((person) => {
        const row = rows.get(person.id);
        if (!row) return unknown(person);
        const ownCount = current && wasOn(person.id) && current.dueDate === when.date ? 1 : 0;
        return dayRow(person, row, ownBlock(person.id), ownCount, input);
      }),
    };
  }

  const free: PickerRow[] = [];
  const busy: PickerRow[] = [];
  for (const person of input.people) {
    const row = rows.get(person.id);
    // A person with no answer is offered, with nothing claimed about their day.
    if (!row) free.push(unknown(person));
    else {
      const placed = eventRow(person, row, when.window, ownBlock(person.id), input);
      (placed.group === "busy" ? busy : free).push(placed.row);
    }
  }
  return { kind: "event", free, busy };
}

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** "Find a person": the rows whose name holds what was typed, whatever its case or accents. */
export function searchPicker(list: PickerList, query: string): PickerList {
  const needle = fold(query);
  if (!needle) return list;
  const keep = (rows: readonly PickerRow[]) =>
    rows.filter((row) => fold(row.name).includes(needle));
  return list.kind === "event"
    ? { kind: "event", free: keep(list.free), busy: keep(list.busy) }
    : { kind: "day", rows: keep(list.rows) };
}

export function pickerCount(list: PickerList): number {
  return list.kind === "event" ? list.free.length + list.busy.length : list.rows.length;
}

/** A row by person, for the chips in the form. */
export function pickerRowOf(list: PickerList, memberId: string): PickerRow | null {
  const rows = list.kind === "event" ? [...list.free, ...list.busy] : list.rows;
  return rows.find((row) => row.memberId === memberId) ?? null;
}

function dayWords(date: ISODate): string {
  // Noon IST names the day without any risk of a timezone edge.
  return formatIST(`${date}T12:00:00+05:30`, "EEE d MMM");
}

/**
 * The line under "Who's on it?": "Shoot · Sat 14 Nov · 3:00 pm – 5:00 pm" (the app's one time
 * format), "· all day" for an event with no time, "Normal · due Sat 14 Nov, 6:00 pm" for a
 * deadline, and what to pick first while there is no day.
 */
export function pickerSubtitle(input: {
  typeName: string;
  event: boolean;
  when: PickerWhen | null;
  /** The deadline's instant, for a deadline-only task. */
  dueAt: string | null;
}): string {
  const { when } = input;
  if (!when) {
    return `${input.typeName} · ${input.event ? "pick the day to see who is free" : "pick the deadline to see their day"}`;
  }
  if (when.kind === "deadline") {
    return `${input.typeName} · due ${input.dueAt ? formatDateTime(input.dueAt, "EEE d MMM") : dayWords(when.date)}`;
  }
  const time = when.window
    ? `${formatTime(when.window.startAt)} – ${formatTime(when.window.endAt)}`
    : "all day";
  return `${input.typeName} · ${dayWords(when.date)} · ${time}`;
}

/** "2 chosen · Asha Rao, Ravi Kumar" at the sheet's foot; "Nobody chosen yet". */
export function chosenLine(names: readonly string[]): string {
  if (names.length === 0) return "Nobody chosen yet";
  return `${names.length} chosen · ${names.join(", ")}`;
}

/** "2 chosen · Asha Rao (primary owner)" in the dialog's footer. */
export function chosenOwnerLine(count: number, primaryName: string | null): string {
  if (count === 0) return "Nobody chosen yet";
  return `${count} chosen${primaryName ? ` · ${primaryName} (primary owner)` : ""}`;
}
