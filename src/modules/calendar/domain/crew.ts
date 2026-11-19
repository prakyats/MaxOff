import { bookedByWord, bookingTime } from "@/core/lib/booking-words";
import { addISTDays, formatIST, type ISODate, istDayStart } from "@/core/time";

import type { AvailabilitySource, CalendarScope, EventSource, LeaveSource } from "./calendar";

/**
 * The Crew on a day (v6.0 "Admin calendar"; owner 13 and 14 Nov 2026, #89 6847654724 and
 * 6874042506; PERMISSIONS §2 "Availability of others"), for the Owner and Admins only: who is
 * **Busy** ("Asha · Shoot · 2:00 pm – 4:00 pm · booked by Nikhil Rao"), who is **On leave** and
 * who is **Free**, over the active people they can see. It replaces "Who's free" and its
 * "Everyone is available" line.
 *
 * **Every booking counts**: the viewer's own, the ones they made for others, the Owner's. A
 * date-only event is busy all day. A busy row says the person, the task's type, the time and who
 * booked it, **never a title, a client or a location**: an Admin's rows come from
 * `member_availability()`, which holds none of those; the Owner's from the event tasks the Owner
 * already reads, cut down to the same four facts.
 *
 * The Owner is named only when busy: never Free, never on leave (6b.2, unchanged). A pending leave
 * request is not leave. A completed or cancelled event is no booking. Pure (ADR-0011).
 *
 * The page builds one `CrewSource` for the range it read (`buildCrew`) and the screen asks it for
 * a day (`crewOn`); the source names each person once and lists only the days with a booking or
 * leave, so a month of it stays small on the wire.
 */

export type CrewPerson = {
  id: string;
  /** As the calendar names them: the full name, a freelancer "(freelancer)". */
  name: string;
  avatarFileId?: string | null;
};

/** One booking as it travels: the person, the time, the type and who booked it. */
export type CrewBooking = {
  memberId: string;
  /** Null for a date-only event: busy all day. */
  startAt: string | null;
  endAt: string | null;
  typeName: string | null;
  /** The type's colour, for its dot. */
  color: string;
  /** "you", "Owner" or the creator's full name; null when unknown. */
  by: string | null;
};

export type CrewSource = {
  people: readonly CrewPerson[];
  /** Named only when busy (the Owner). */
  busyOnly: readonly CrewPerson[];
  /** Only the days with a booking or leave. `leave` is `[memberId, kind]`. */
  days: Readonly<
    Record<
      ISODate,
      { busy: readonly CrewBooking[]; leave: readonly (readonly [string, CrewLeaveKind])[] }
    >
  >;
};

/**
 * A person's leave as the Crew lists say it: a full day, a half day, or comp leave. Only the
 * Owner reads "Comp leave" (the Owner sees leave types); an Admin reads the fact, so theirs is a
 * full day (PERMISSIONS §2 "Availability of others").
 */
export type CrewLeaveKind = "full" | "half" | "comp";

export type CrewBusyRow = {
  memberId: string;
  name: string;
  avatarFileId?: string | null;
  /** "2:00 pm – 4:00 pm" or "All day". */
  when: string;
  allDay: boolean;
  typeName: string;
  color: string;
  /** "booked by you", "booked by Owner", "booked by Nikhil Rao"; "" when unknown. */
  bookedBy: string;
};

export type CrewDay = {
  busy: CrewBusyRow[];
  onLeave: { memberId: string; name: string; kind: CrewLeaveKind }[];
  free: { memberId: string; name: string }[];
  /** How many people could be free: everyone the viewer sees, the Owner apart. */
  people: number;
};

/** The word for a booking with an unknown type (one the viewer's type list does not hold). */
export const BOOKING_FALLBACK_TYPE = "Event";

export function buildCrew(input: {
  scope: CalendarScope;
  viewerId: string;
  /** The organisation's Owner, when the viewer can see them. */
  owner: CrewPerson | null;
  /** The active people the viewer can see, the Owner apart. */
  people: readonly CrewPerson[];
  /** The task types the viewer reads: a booking's name (the Owner's) and its colour. */
  types: readonly { id: string; name: string; color: string }[];
  /** A name for a creator by id (the directory), for the Owner's own reads. */
  nameOf: (memberId: string) => string | null;
  /** The colour of an unknown type. */
  fallbackColor: string;
  /** The Owner's: every event task in the range (RLS). An Admin's are not used. */
  events: readonly EventSource[];
  /** The Owner's: everyone's leave in the range. An Admin's is not used. */
  leave: readonly LeaveSource[];
  /** An Admin's `member_availability()` rows for everyone; null for the Owner. */
  availability: readonly AvailabilitySource[] | null;
}): CrewSource | null {
  if (input.scope === "staff") return null;
  const ownerId = input.owner?.id ?? null;
  const seen = new Set(input.people.map((person) => person.id));
  if (ownerId) seen.add(ownerId);
  const typeOf = new Map(input.types.map((type) => [type.id, type]));
  const days: Record<ISODate, { busy: CrewBooking[]; leave: [string, CrewLeaveKind][] }> = {};
  const dayOf = (date: ISODate) => (days[date] ??= { busy: [], leave: [] });
  const setLeave = (date: ISODate, memberId: string, kind: CrewLeaveKind) => {
    // The Owner is never on leave here; a whole day (leave or comp leave) wins over a half day.
    if (!seen.has(memberId) || memberId === ownerId) return;
    const day = dayOf(date);
    const at = day.leave.findIndex(([id]) => id === memberId);
    if (at < 0) day.leave.push([memberId, kind]);
    else if (kind !== "half" && day.leave[at]?.[1] === "half") day.leave[at] = [memberId, kind];
  };

  if (input.scope === "admin") {
    for (const row of input.availability ?? []) {
      if (!seen.has(row.memberId)) continue;
      if (row.leave === "leave" || row.leave === "comp_leave") {
        // An Admin reads the fact of leave, never its type.
        setLeave(row.day, row.memberId, "full");
      } else if (row.leave === "half_day") setLeave(row.day, row.memberId, "half");
      for (const block of row.blocks) {
        const type = block.typeId ? typeOf.get(block.typeId) : undefined;
        dayOf(row.day).busy.push({
          memberId: row.memberId,
          startAt: block.startAt,
          endAt: block.startAt ? block.endAt : null,
          typeName: block.typeName ?? type?.name ?? null,
          color: type?.color ?? input.fallbackColor,
          by: bookedByWord(
            { id: block.bookedById ?? null, name: block.bookedByName ?? null },
            input.viewerId,
            ownerId,
          ),
        });
      }
    }
  } else {
    for (const event of input.events) {
      if (event.state === "cancelled" || event.state === "completed") continue;
      const type = typeOf.get(event.taskTypeId);
      const creator = event.createdById ?? null;
      for (const memberId of event.assigneeIds) {
        if (!seen.has(memberId)) continue;
        dayOf(event.eventDate).busy.push({
          memberId,
          startAt: event.eventStartAt,
          endAt: event.eventStartAt ? event.eventEndAt : null,
          typeName: type?.name ?? null,
          color: type?.color ?? input.fallbackColor,
          by: bookedByWord(
            { id: creator, name: creator ? input.nameOf(creator) : null },
            input.viewerId,
            ownerId,
          ),
        });
      }
    }
    for (const span of input.leave) {
      if (span.pending) continue;
      for (let date = span.startDate; date <= span.endDate; date = addISTDays(date, 1)) {
        setLeave(
          date,
          span.memberId,
          span.type === "half_day" ? "half" : span.type === "comp_leave" ? "comp" : "full",
        );
      }
    }
  }
  return {
    people: input.people,
    busyOnly: input.owner ? [input.owner] : [],
    days,
  };
}

/** The Crew on one day: Busy (the all-day ones first, then by start), On leave, Free. */
export function crewOn(source: CrewSource, date: ISODate): CrewDay {
  const day = source.days[date];
  const everyone = [...source.people, ...source.busyOnly];
  const personOf = new Map(everyone.map((person) => [person.id, person]));
  const onlyBusy = new Set(source.busyOnly.map((person) => person.id));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

  const booked = new Set<string>();
  const rows: { row: CrewBusyRow; start: number }[] = [];
  for (const booking of day?.busy ?? []) {
    const person = personOf.get(booking.memberId);
    if (!person) continue;
    booked.add(person.id);
    rows.push({
      // The all-day ones first, then by start.
      start: booking.startAt ? new Date(booking.startAt).getTime() : -1,
      row: {
        memberId: person.id,
        name: person.name,
        ...(person.avatarFileId ? { avatarFileId: person.avatarFileId } : {}),
        when: bookingTime(booking),
        allDay: booking.startAt === null,
        typeName: booking.typeName ?? BOOKING_FALLBACK_TYPE,
        color: booking.color,
        bookedBy: booking.by ? `booked by ${booking.by}` : "",
      },
    });
  }
  rows.sort((a, b) => a.start - b.start || byName(a.row, b.row));

  const leave = new Map(day?.leave ?? []);
  const onLeave: CrewDay["onLeave"] = [];
  const free: CrewDay["free"] = [];
  for (const person of [...source.people].sort(byName)) {
    if (onlyBusy.has(person.id)) continue;
    const kind = leave.get(person.id);
    if (kind !== undefined) onLeave.push({ memberId: person.id, name: person.name, kind });
    else if (!booked.has(person.id)) free.push({ memberId: person.id, name: person.name });
  }
  return {
    busy: rows.map((entry) => entry.row),
    onLeave,
    free,
    people: source.people.filter((person) => !onlyBusy.has(person.id)).length,
  };
}

/** Whether nobody is busy or on leave: the only time the day says "Everyone is available". */
export function everyoneAvailable(crew: CrewDay): boolean {
  return crew.busy.length === 0 && crew.onLeave.length === 0 && crew.free.length > 0;
}

export const EVERYONE_AVAILABLE = "Everyone is available";

/**
 * "Arjun Rao · Half day" / "Arjun Rao · Comp leave" / "Arjun Rao": a person on leave, as the
 * lists name them.
 */
export function leaveName(person: { name: string; kind: CrewLeaveKind }): string {
  if (person.kind === "half") return `${person.name} · Half day`;
  return person.kind === "comp" ? `${person.name} · Comp leave` : person.name;
}

/** Whether the day has anyone to say anything about: a booking, leave, or someone free. */
export function hasCrew(crew: CrewDay): boolean {
  return crew.busy.length + crew.onLeave.length + crew.free.length > 0;
}

/**
 * A day as it is drawn beside the Crew lists (the Owner's and Admins' day, Day and day popup):
 * approved leave is said once, in "On leave", so only a request still waiting keeps its chip
 * ("· requested"). The month's bars are not this: they keep every leave.
 */
export function besideCrew<Day extends { leave: readonly { pending: boolean }[] }>(day: Day): Day {
  return { ...day, leave: day.leave.filter((item) => item.pending) };
}

/**
 * Whether such a day has nothing of its own to show ("Nothing on this day."): no holiday or
 * weekly off, no leave request, no event, nothing due and no client work. The Crew lists show
 * either way; someone else's booking or approved leave is theirs, not the day's.
 */
export function nothingBesideCrew(day: {
  holiday: string | null;
  weeklyOff: boolean;
  leave: readonly { pending: boolean }[];
  events: readonly unknown[];
  due: readonly unknown[];
  items: readonly unknown[];
}): boolean {
  return (
    day.holiday === null &&
    !day.weeklyOff &&
    !day.leave.some((item) => item.pending) &&
    day.events.length + day.due.length + day.items.length === 0
  );
}

/** "Sat 14": a day as the Crew card, the Day's pills and the Week's rows name it. */
export function shortDayName(date: ISODate): string {
  return formatIST(istDayStart(date), "EEE d");
}

/**
 * The Week table's "Events · due" cell: the titles of the events the viewer can see, how many are
 * due, and the day off it is ("Weekly off", or the holiday's name).
 */
export function weekEvents(day: {
  holiday: string | null;
  weeklyOff: boolean;
  events: readonly { title: string }[];
  due: number;
}): { titles: string; due: string; off: string | null } {
  return {
    titles: day.events.map((event) => event.title).join(", "),
    due: day.due > 0 ? `${day.due} due` : "",
    off: day.holiday ?? (day.weeklyOff ? "Weekly off" : null),
  };
}

/**
 * The Week table's Free cell: "Everyone" when all are, "Nobody" when none, up to two names, else
 * "5 people" (the approved sample).
 */
export function freeSummary(crew: CrewDay): string {
  if (crew.free.length === 0) return "Nobody";
  if (crew.free.length === crew.people) return "Everyone";
  if (crew.free.length <= 2) return crew.free.map((person) => person.name).join(", ");
  return `${crew.free.length} people`;
}
