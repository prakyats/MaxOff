import { formatTime } from "@/core/time";

import { displayName } from "./display-name";

/**
 * How a booking is said (v6.0 "Admin calendar"; owner 13 and 14 Nov 2026): who booked it and
 * when, in the same words on the calendar's Busy rows and in the task form's "Who's on it?".
 * Shared here because modules never import each other (CLAUDE.md, engineering rule 2). Pure.
 */

const HOUR_MS = 60 * 60 * 1000;

/** "you", "Owner" or the creator's full name: who booked it; null when unknown. */
export function bookedByWord(
  creator: { id: string | null; name: string | null },
  viewerId: string,
  ownerId: string | null,
): string | null {
  if (!creator.id) return creator.name ? displayName(creator.name) : null;
  if (creator.id === viewerId) return "you";
  if (creator.id === ownerId) return "Owner";
  return creator.name ? displayName(creator.name) : null;
}

/** "2:00 pm – 4:00 pm" (the one time format, B1), "All day" with no start; no end is an hour. */
export function bookingTime(booking: { startAt: string | null; endAt: string | null }): string {
  if (!booking.startAt) return "All day";
  const end =
    booking.endAt ?? new Date(new Date(booking.startAt).getTime() + HOUR_MS).toISOString();
  return `${formatTime(booking.startAt)} – ${formatTime(end)}`;
}
