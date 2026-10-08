import { addISTDays, type ISODate } from "@/core/time";

import { addMonths, monthOf } from "./calendar";

/**
 * The phone calendar's three snap sizes (6.4b; Kickoff 6 decision 25 A): (1) the week strip with
 * the day's detail, (2) the compact month with thin bars and the day's detail (the opening size,
 * today selected), (3) the full month with labelled strips. A vertical swipe on the calendar grows
 * (down) or shrinks (up) it; a left or right swipe moves a week (size 1) or a month (2 and 3). The
 * handle under it is a button that grows it, and at the full month shows less. Size and the
 * selected day are view state, never history (ARCHITECTURE §14.2 d). Pure.
 */

export type CalendarSize = 1 | 2 | 3;

export const OPENING_SIZE: CalendarSize = 2;

/** How far a finger must travel (px) along one axis for a swipe, and more than along the other. */
export const SWIPE_PX = 40;

export function grow(size: CalendarSize): CalendarSize {
  return size === 1 ? 2 : 3;
}

export function shrink(size: CalendarSize): CalendarSize {
  return size === 3 ? 2 : 1;
}

/**
 * The handle: "Show more of the month" grows the calendar a size; at the full month "Show less"
 * goes back to the week, so a keyboard reaches every size in turn.
 */
export function handleNext(size: CalendarSize): CalendarSize {
  return size === 3 ? 1 : grow(size);
}

export function handleLabel(size: CalendarSize): string {
  return size === 3 ? "Show less" : "Show more of the month";
}

export type Swipe = "up" | "down" | "left" | "right";

/** A finger's travel as a swipe: the dominant axis past `SWIPE_PX`, else nothing (a tap). */
export function swipeOf(dx: number, dy: number, threshold = SWIPE_PX): Swipe | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < threshold && ay < threshold) return null;
  if (ay > ax) return dy > 0 ? "down" : "up";
  if (ax > ay) return dx > 0 ? "right" : "left";
  return null;
}

/** The size after a vertical swipe (down grows, up shrinks); a sideways swipe keeps it. */
export function sizeAfter(size: CalendarSize, swipe: Swipe): CalendarSize {
  if (swipe === "down") return grow(size);
  if (swipe === "up") return shrink(size);
  return size;
}

/**
 * The selected day after moving a week (size 1) or a month (sizes 2 and 3). A month move keeps
 * the day of the month where it can (31 Oct → 30 Nov) and lands on today in today's month.
 */
export function stepDate(
  selected: ISODate,
  size: CalendarSize,
  direction: -1 | 1,
  today: ISODate,
): ISODate {
  if (size === 1) return addISTDays(selected, 7 * direction);
  const month = addMonths(monthOf(selected), direction);
  if (month === monthOf(today)) return today;
  const day = Number(selected.slice(8, 10));
  const last = Number(addISTDays(addMonths(month, 1), -1).slice(8, 10));
  return `${month.slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** Sideways: left shows the next week or month, right the one before (as the phone's own apps). */
export function directionOf(swipe: Swipe): -1 | 1 | null {
  if (swipe === "left") return 1;
  if (swipe === "right") return -1;
  return null;
}
