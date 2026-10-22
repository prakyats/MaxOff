import {
  addISTDays,
  formatIST,
  formatTime,
  formatWallTime,
  type ISODate,
  toISTDate,
} from "@/core/time";

/**
 * When a notification came, as a history row says it (IST, kickoff 5 decision 4): the time alone
 * for today's and yesterday's ("4:05 pm": the Today and Yesterday headings say the day; V5b-D,
 * the approved pull-in sample), the day this year ("3 Oct, 4:05 pm"), and the year too before
 * that ("3 Oct 2025").
 */
export function notificationWhen(createdAt: string, today: ISODate): string {
  const day = toISTDate(createdAt);
  const time = formatTime(createdAt);
  if (day === today || day === addISTDays(today, -1)) return time;
  if (day.slice(0, 4) === today.slice(0, 4)) return `${formatIST(createdAt, "d MMM")}, ${time}`;
  return formatIST(createdAt, "d MMM yyyy");
}

/**
 * PP-alerts-1 (V5b): a notification written before the one time format (B1) kept its words, so an
 * old body still says "Due at 18:00". On screen every time reads "6:00 pm": a 24-hour "HH:MM" in
 * the stored text is shown on the 12-hour clock (`formatWallTime`). Display only; what was sent
 * is never rewritten. A time already followed by am/pm is left alone.
 */
export function twelveHourTimes(text: string): string {
  return text.replace(/\b([01]\d|2[0-3]):([0-5]\d)\b(?!\s?[ap]\.?m)/gi, (time) =>
    formatWallTime(time),
  );
}
