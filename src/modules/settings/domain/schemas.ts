import { z } from "zod";

import { isISODate } from "@/core/time";

export const COMPANY_NAME_MAX = 120;
export const HOLIDAY_NAME_MAX = 120;
/** The table's own checks say the same; these messages are what the form shows. */
export const MAX_HOURS = 240;
export const MAX_EMAIL_CAP = 200;

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
    ackRepeatHours: hours("The acknowledgement reminder"),
    ackEscalateHours: hours("The escalation to the Admin"),
    ackEscalateOwnerHours: hours("The escalation to the Owner"),
    overdueEscalateHours: hours("The overdue escalation"),
    emailDailyCapPerMember: z.coerce
      .number({ error: "The email cap is a number." })
      .int("The email cap is a whole number.")
      .min(0, "The email cap cannot be negative.")
      .max(MAX_EMAIL_CAP, `Keep the email cap at ${MAX_EMAIL_CAP} or less.`),
  })
  // An escalation that reaches the Owner before the Admin would skip the first level entirely
  // (WORKFLOWS §9: level 1 is the approving Admin, level 2 the Owner).
  .refine((values) => values.ackEscalateOwnerHours >= values.ackEscalateHours, {
    path: ["ackEscalateOwnerHours"],
    message: "The Owner is the second level, so this cannot be sooner than the Admin escalation.",
  });
export type UpdateThresholdsInput = z.input<typeof updateThresholdsSchema>;
