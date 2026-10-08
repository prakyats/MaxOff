import { toISTDate, toISTTime, type ISODate } from "@/core/time";

import type { BusyItem, CalendarDay, EventItem } from "./calendar";

/**
 * The hour timelines (6.4b; Kickoff 6 decision 25 E): the phone's day detail and the laptop's Week
 * and Day. Hours 08:00–22:00 are in view, the rest a scroll away; on today it scrolls to now and a
 * "now" line crosses it. An event sits at its time (no end: an hour long); one with no start, the
 * holiday, leave and "Due · N" sit in the all-day row above the hours. Events that overlap share
 * the width side by side. Pure: minutes from the IST day's midnight, laid out here, drawn by CSS.
 */

export const DAY_MINUTES = 24 * 60;
/** The window in view when the timeline opens (decision 25 E). */
export const VISIBLE_FROM_HOUR = 8;
export const VISIBLE_TO_HOUR = 22;
const HOUR = 60;

/** Minutes since the IST midnight of `date` for an instant, clamped to that day. */
export function minutesInDay(instant: string, date: ISODate): number {
  const day = toISTDate(instant);
  if (day < date) return 0;
  if (day > date) return DAY_MINUTES;
  const [hours, minutes] = toISTTime(instant).split(":").map(Number);
  return (hours ?? 0) * HOUR + (minutes ?? 0);
}

export type TimedItem = EventItem | BusyItem;

export type PlacedBlock = {
  item: TimedItem;
  /** Minutes from midnight. */
  start: number;
  end: number;
  /** Its column among the blocks it overlaps, and how many there are. */
  column: number;
  columns: number;
};

/**
 * The timed blocks of a day, laid out: each from its start to its end (an hour when it has none,
 * at least a quarter of an hour so it can be seen), overlapping ones in side-by-side columns.
 */
export function placeBlocks(day: Pick<CalendarDay, "date" | "events" | "busy">): PlacedBlock[] {
  const timed: Omit<PlacedBlock, "column" | "columns">[] = [];
  for (const item of [...day.events, ...day.busy]) {
    if (!item.startAt) continue;
    const start = minutesInDay(item.startAt, day.date);
    const rawEnd = item.endAt ? minutesInDay(item.endAt, day.date) : start + HOUR;
    const end = Math.min(DAY_MINUTES, Math.max(rawEnd, start + 15));
    timed.push({ item, start, end });
  }
  timed.sort((a, b) => a.start - b.start || b.end - a.end);

  const placed: PlacedBlock[] = [];
  let cluster: PlacedBlock[] = [];
  let clusterEnd = -1;
  const close = () => {
    const columns = Math.max(1, ...cluster.map((block) => block.column + 1));
    for (const block of cluster) block.columns = columns;
    placed.push(...cluster);
    cluster = [];
  };
  for (const block of timed) {
    if (block.start >= clusterEnd && cluster.length > 0) close();
    const used = new Set(cluster.filter((other) => other.end > block.start).map((o) => o.column));
    let column = 0;
    while (used.has(column)) column += 1;
    cluster.push({ ...block, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  if (cluster.length > 0) close();
  return placed;
}

/** The events with no start time: they sit in the all-day row. */
export function allDayEvents(day: Pick<CalendarDay, "events">): EventItem[] {
  return day.events.filter((event) => event.startAt === null);
}

/** Where the timeline scrolls when it opens: now (an hour above it) on today, else 08:00. */
export function openingMinute(date: ISODate, today: ISODate, nowMinute: number): number {
  if (date !== today) return VISIBLE_FROM_HOUR * HOUR;
  return Math.max(0, Math.min(nowMinute - HOUR, (VISIBLE_TO_HOUR - 1) * HOUR));
}

/** "08:00", for the hour rail. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
