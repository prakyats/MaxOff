/**
 * The Team today card (v6.5 unit 10; owner 14 Nov 2026, #89 6874350719 and 6874389662; the
 * approved sample "2 · Admin Today: Team today card"), for the Owner and Admins on Today: three
 * counts (free now, booked today, on leave) and one line per person ("Shoot 2:00 pm – 4:00 pm ·
 * you", "Free all day", "On leave"). Built from the bookings and leave of `CrewSource` (v6.0 unit
 * A: `member_availability()`), **never attendance times**. The Owner is never counted free or on
 * leave (6b.2): named only when booked. Pure (ADR-0011).
 */
import { bookingTime } from "@/core/lib/booking-words";
import type { ISODate } from "@/core/time";

import { BOOKING_FALLBACK_TYPE, type CrewBooking, type CrewSource } from "./crew";

export type TeamLine = {
  memberId: string;
  name: string;
  avatarFileId?: string | null;
  kind: "booked" | "free" | "leave" | "half";
  /** "Shoot 2:00 pm – 4:00 pm", "Free all day", "On leave", "Half day". */
  text: string;
  /** "you", "booked by Nikhil Rao", or "" (only for a booking). */
  by: string;
  /** The booking type's colour, for its dot. */
  color: string | null;
  /** Bookings after the one named: "+1". */
  more: number;
};

export type TeamToday = {
  freeNow: number;
  bookedToday: number;
  onLeave: number;
  lines: TeamLine[];
};

/** Lines shown before "Show all N" (the card opens in place, no history step). */
export const TEAM_FIRST_LINES = 5;

function startOf(booking: CrewBooking): number {
  return booking.startAt ? Date.parse(booking.startAt) : Number.NEGATIVE_INFINITY;
}

function endOf(booking: CrewBooking): number {
  if (!booking.startAt) return Number.POSITIVE_INFINITY;
  return booking.endAt ? Date.parse(booking.endAt) : Date.parse(booking.startAt) + 60 * 60 * 1000;
}

/** Inside a booking at `at` (an all-day booking is busy all day). */
export function busyAt(bookings: readonly CrewBooking[], at: number): boolean {
  return bookings.some((booking) => startOf(booking) <= at && at < endOf(booking));
}

/** The booking a line names: the one going on now, else the next, else the last of the day. */
function named(bookings: readonly CrewBooking[], at: number): CrewBooking {
  const sorted = [...bookings].sort((a, b) => startOf(a) - startOf(b));
  return (
    sorted.find((booking) => startOf(booking) <= at && at < endOf(booking)) ??
    sorted.find((booking) => startOf(booking) > at) ??
    (sorted.at(-1) as CrewBooking)
  );
}

export function teamToday(source: CrewSource, date: ISODate, now: Date): TeamToday {
  const at = now.getTime();
  const day = source.days[date];
  const byPerson = new Map<string, CrewBooking[]>();
  for (const booking of day?.busy ?? []) {
    const list = byPerson.get(booking.memberId) ?? [];
    list.push(booking);
    byPerson.set(booking.memberId, list);
  }
  const leave = new Map(day?.leave ?? []);
  const owner = new Set(source.busyOnly.map((person) => person.id));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

  const booked: { line: TeamLine; start: number }[] = [];
  const free: TeamLine[] = [];
  const away: TeamLine[] = [];
  let freeNow = 0;
  for (const person of [...source.people, ...source.busyOnly]) {
    const bookings = byPerson.get(person.id) ?? [];
    const base = {
      memberId: person.id,
      name: person.name,
      ...(person.avatarFileId ? { avatarFileId: person.avatarFileId } : {}),
    };
    const kind = leave.get(person.id);
    if (bookings.length > 0) {
      const shown = named(bookings, at);
      booked.push({
        start: startOf(shown),
        line: {
          ...base,
          kind: "booked",
          text: `${shown.typeName ?? BOOKING_FALLBACK_TYPE} ${bookingTime(shown)}`,
          by: shown.by === "you" ? "you" : shown.by ? `booked by ${shown.by}` : "",
          color: shown.color,
          more: bookings.length - 1,
        },
      });
      if (!owner.has(person.id) && kind === undefined && !busyAt(bookings, at)) freeNow += 1;
      continue;
    }
    if (owner.has(person.id)) continue;
    if (kind === "half") {
      away.push({ ...base, kind: "half", text: "Half day", by: "", color: null, more: 0 });
    } else if (kind !== undefined) {
      away.push({ ...base, kind: "leave", text: "On leave", by: "", color: null, more: 0 });
    } else {
      freeNow += 1;
      free.push({ ...base, kind: "free", text: "Free all day", by: "", color: null, more: 0 });
    }
  }
  booked.sort((a, b) => a.start - b.start || byName(a.line, b.line));
  return {
    freeNow,
    bookedToday: booked.length,
    onLeave: away.length,
    lines: [...booked.map((entry) => entry.line), ...free.sort(byName), ...away.sort(byName)],
  };
}

/** One row of `member_next_booking()` (v6.5 unit 13), as the data layer gives it. */
export type NextBooking = {
  memberId: string;
  onDate: ISODate;
  startAt: string | null;
  endAt: string | null;
  typeName: string | null;
  /** "you", "Owner" or the creator's name (`bookedByWord`); null when unknown. */
  by: string | null;
};

/**
 * People's "Next booked" for an Admin (the approved sample "4 · People (Admin)"): "Thu 19 ·
 * Meeting 10:00 am · Sana", "Tue 17 · Shoot all day · you"; "Nothing booked" without one.
 */
export function nextBookedLine(
  next: NextBooking | undefined,
  dayName: (date: ISODate) => string,
): string {
  if (!next) return "Nothing booked";
  const type = next.typeName ?? BOOKING_FALLBACK_TYPE;
  const when = next.startAt
    ? bookingTime({ startAt: next.startAt, endAt: null }).split(" – ")[0]
    : "all day";
  return [dayName(next.onDate), `${type} ${when}`, next.by].filter(Boolean).join(" · ");
}

/**
 * People's Today for someone on leave (the approved sample "4"): "On leave · back Tue 17", with the
 * first working day they are back (`member_people_glance()`), or "On leave" when none is known.
 */
export function onLeaveLine(backOn: ISODate | null, dayName: (date: ISODate) => string): string {
  return backOn ? `On leave · back ${dayName(backOn)}` : "On leave";
}
