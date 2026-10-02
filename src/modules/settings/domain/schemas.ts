import { z } from "zod";

import { isISODate } from "@/core/time";

export const COMPANY_NAME_MAX = 120;
export const HOLIDAY_NAME_MAX = 120;
/** The table's own checks say the same; these messages are what the form shows. */
export const MAX_HOURS = 240;
export const MAX_EMAIL_CAP = 200;
/** A workload warning at more than this many open tasks due in one day would never fire. */
export const MAX_WORKLOAD_THRESHOLD = 50;

export const updateCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A company name is required.")
    .max(COMPANY_NAME_MAX, `Keep the name under ${COMPANY_NAME_MAX} characters.`),
});
export type UpdateCompanyInput = z.input<typeof updateCompanySchema>;

export const updateWeeklyOffSchema = z.object({
  weeklyOffDays: z
    .array(
      z.coerce.number().int().min(0, "That is not a weekday.").max(6, "That is not a weekday."),
    )
    .max(7)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b))
    .refine((days) => days.length < 7, {
      message: "At least one day has to be a working day.",
    }),
});
export type UpdateWeeklyOffInput = z.input<typeof updateWeeklyOffSchema>;

const isoDate = z
  .string()
  .trim()
  .refine((value) => isISODate(value), { message: "Pick a date." });

export const createHolidaySchema = z.object({
  date: isoDate,
  name: z
    .string()
    .trim()
    .min(1, "A name is required.")
    .max(HOLIDAY_NAME_MAX, `Keep the name under ${HOLIDAY_NAME_MAX} characters.`),
});
export type CreateHolidayInput = z.input<typeof createHolidaySchema>;

export const holidayIdSchema = z.object({ holidayId: z.uuid() });
export type HolidayIdInput = z.input<typeof holidayIdSchema>;

const clockTime = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 22:00.");

const hours = (label: string) =>
  z.coerce
    .number({ error: `${label} is a number of hours.` })
    .int(`${label} is a whole number of hours.`)
    .min(1, `${label} has to be at least 1 hour.`)
    .max(MAX_HOURS, `${label} has to be ${MAX_HOURS} hours or less.`);

export const updateThresholdsSchema = z
  .object({
    logoutReminderTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 20:30."),
    // The next morning: past noon it would swallow the working day it is meant to guard.
    endDayCutoffTime: z
      .string()
      .trim()
      .regex(/^(0\d|1[01]):[0-5]\d$/, "Use a morning time between 00:00 and 11:59, like 05:00."),
    ackRepeatHours: hours("The acknowledgement reminder"),
    ackEscalateHours: hours("The escalation to the Admin"),
    ackEscalateOwnerHours: hours("The escalation to the Owner"),
    overdueEscalateHours: hours("The overdue escalation"),
    emailDailyCapPerMember: z.coerce
      .number({ error: "The email cap is a number." })
      .int("The email cap is a whole number.")
      .min(0, "The email cap cannot be negative.")
      .max(MAX_EMAIL_CAP, `Keep the email cap at ${MAX_EMAIL_CAP} or less.`),
    workloadWarningThreshold: z.coerce
      .number({ error: "The workload warning is a number of tasks." })
      .int("The workload warning is a whole number of tasks.")
      .min(1, "The workload warning needs at least 1 task.")
      .max(
        MAX_WORKLOAD_THRESHOLD,
        `Keep the workload warning at ${MAX_WORKLOAD_THRESHOLD} or less.`,
      ),
    // Quiet hours, IST (5B decision 6). The window may run past midnight (22:00-07:00).
    quietHoursStart: clockTime,
    quietHoursEnd: clockTime,
  })
  // An escalation that reaches the Owner before the Admin would skip the first level entirely
  // (WORKFLOWS §9: level 1 is the approving Admin, level 2 the Owner).
  .refine((values) => values.ackEscalateOwnerHours >= values.ackEscalateHours, {
    path: ["ackEscalateOwnerHours"],
    message: "The Owner is the second level, so this cannot be sooner than the Admin escalation.",
  })
  // The same start and end would mean no quiet hours at all (`public.push_quiet`), and
  // quiet hours hold for everyone (kickoff 5 decision 5): an equal pair is refused, not "off".
  .refine((values) => values.quietHoursEnd !== values.quietHoursStart, {
    path: ["quietHoursEnd"],
    message: "Quiet hours need an end time different from the start.",
  });
export type UpdateThresholdsInput = z.input<typeof updateThresholdsSchema>;
