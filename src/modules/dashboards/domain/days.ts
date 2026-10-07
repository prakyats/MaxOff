import { addISTDays, formatIST, istDayStart, toISTDate, type ISODate } from "@/core/time";

/**
 * Day words the dashboards share (6A): "Today", "Tomorrow", else "Thu 8 Oct", always the IST day
 * (ADR-0008). Pure, so the dashboards' rules are unit-tested.
 */

/** "Today", "Tomorrow" or "Thu 8 Oct". */
export function dayWord(date: ISODate, today: ISODate): string {
  if (date === today) return "Today";
  if (date === addISTDays(today, 1)) return "Tomorrow";
  return formatIST(istDayStart(date), "EEE d MMM");
}

/** The same inside a sentence: "today", "tomorrow" or "Thu 8 Oct". */
export function inlineDay(date: ISODate, today: ISODate): string {
  const word = dayWord(date, today);
  return word === "Today" || word === "Tomorrow" ? word.toLowerCase() : word;
}

/** An instant's IST time of day: "10:00 am". */
export function clockWord(instant: string): string {
  return formatIST(instant, "h:mm aaa");
}

/** The IST days from `today` through `days - 1` days later. */
export function nextDays(today: ISODate, days: number): ISODate[] {
  return Array.from({ length: days }, (_, offset) => addISTDays(today, offset));
}

/** Whether an instant falls on an IST date in [from, to]. */
export function instantWithin(instant: string, from: ISODate, to: ISODate): boolean {
  const date = toISTDate(instant);
  return date >= from && date <= to;
}
