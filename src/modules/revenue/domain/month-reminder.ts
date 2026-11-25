import { z } from "zod";

import { formatIST, istDayStart } from "@/core/time";

/**
 * The month close reminder (v3.5 U6; kickoff 9 decision 19, v3.5 Q8 and Q9; WORKFLOWS §7.3): from the
 * 6th of the month after M (IST), the oldest month from the first priced month on that is still not
 * closed, and how many more. The Owner's Reports line says it; the weekly digest says the same words
 * (`app.month_close_reminder_line`, its SQL twin). The month only, never an amount.
 */
export type MonthReminder = { month: string; more: number };

/** `month_close_reminder()`'s answer: `{month, more}` or null when every due month is closed. */
export const monthReminderSchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}-01$/),
    more: z.number().int().min(0),
  })
  .nullable();

/**
 * "September isn't closed yet", "September and 1 more month aren't closed yet", "September and 2
 * more months aren't closed yet"; the year only when it is not today's ("December 2026 isn't
 * closed yet" in January). `today` is the IST date (`YYYY-MM-DD`).
 */
export function monthReminderLine(reminder: MonthReminder, today: string): string {
  const name = reminderMonthName(reminder, today);
  if (reminder.more <= 0) return `${name} isn't closed yet`;
  return `${name} and ${reminder.more} more ${reminder.more === 1 ? "month" : "months"} aren't closed yet`;
}

/** The line's action, naming the month it opens: "Close September" (the close screen's own words). */
export function monthReminderAction(reminder: MonthReminder, today: string): string {
  return `Close ${reminderMonthName(reminder, today)}`;
}

/** "September", or "December 2026" when the month's year is not today's. */
function reminderMonthName(reminder: MonthReminder, today: string): string {
  const start = istDayStart(`${reminder.month.slice(0, 7)}-01`);
  return reminder.month.slice(0, 4) === today.slice(0, 4)
    ? formatIST(start, "MMMM")
    : formatIST(start, "MMMM yyyy");
}
