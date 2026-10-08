import { addISTDays, formatIST, istDayStart, istWeekday, type ISODate } from "@/core/time";

import type { Recurrence } from "./types";

/**
 * A cycle's period, as the database computes it (`app.period_start`, `app.period_next`,
 * `app.cycle_label`; WORKFLOWS §5.4 "As built": weekly = Monday to Sunday, monthly = the calendar
 * month, IST), for "Start next cycle" (decision 3: the next period, at most 7 days early). Pure.
 */

export function periodStart(recurrence: Exclude<Recurrence, "one_time">, day: ISODate): ISODate {
  if (recurrence === "monthly") return `${day.slice(0, 8)}01`;
  const weekday = istWeekday(day); // 0 = Sunday
  return addISTDays(day, -((weekday + 6) % 7));
}

export function periodNext(recurrence: Exclude<Recurrence, "one_time">, start: ISODate): ISODate {
  if (recurrence === "weekly") return addISTDays(start, 7);
  const [year, month] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

const at = (day: ISODate, pattern: string) => formatIST(istDayStart(day), pattern);

/** "October 2026" / "5–11 Oct 2026" / "29 Sep–5 Oct 2026" / "29 Dec 2026–4 Jan 2027". */
export function cycleLabel(recurrence: Exclude<Recurrence, "one_time">, start: ISODate): string {
  if (recurrence === "monthly") return at(start, "MMMM yyyy");
  const end = addISTDays(start, 6);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${at(start, "d")}–${at(end, "d MMM yyyy")}`;
  if (start.slice(0, 4) === end.slice(0, 4))
    return `${at(start, "d MMM")}–${at(end, "d MMM yyyy")}`;
  return `${at(start, "d MMM yyyy")}–${at(end, "d MMM yyyy")}`;
}

/**
 * The next period "Start next cycle" may begin now (decision 3), or null: a one-time project, a
 * next period more than 7 days away, or one that already has its cycle.
 */
export function nextStartable(
  recurrence: Recurrence,
  today: ISODate,
  existingStarts: readonly (string | null)[],
): { start: ISODate; label: string } | null {
  if (recurrence === "one_time") return null;
  const next = periodNext(recurrence, periodStart(recurrence, today));
  const daysAway =
    (istDayStart(next).getTime() - istDayStart(today).getTime()) / (24 * 60 * 60 * 1000);
  if (daysAway > 7 || existingStarts.includes(next)) return null;
  return { start: next, label: cycleLabel(recurrence, next) };
}
