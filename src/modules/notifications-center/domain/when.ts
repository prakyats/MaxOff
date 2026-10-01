import { addISTDays, formatIST, type ISODate, toISTDate } from "@/core/time";

/**
 * When a notification came, as a history row says it (IST, kickoff 5 decision 4): the time for
 * today's ("4:05 pm"), "Yesterday, 4:05 pm", the day this year ("3 Oct, 4:05 pm"), and the year
 * too before that ("3 Oct 2025").
 */
export function notificationWhen(createdAt: string, today: ISODate): string {
  const day = toISTDate(createdAt);
  const time = formatIST(createdAt, "h:mm aaa");
  if (day === today) return time;
  if (day === addISTDays(today, -1)) return `Yesterday, ${time}`;
  if (day.slice(0, 4) === today.slice(0, 4)) return `${formatIST(createdAt, "d MMM")}, ${time}`;
  return formatIST(createdAt, "d MMM yyyy");
}

/** The pager's page from the address: a whole number from 1, else the first page. */
export function pageFrom(value: unknown): number {
  return typeof value === "string" && /^[1-9]\d{0,4}$/.test(value) ? Number(value) : 1;
}
