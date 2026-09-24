import { z } from "zod";

import { ATTENDANCE_CHOICES } from "./choices";

export const ATTENDANCE_REASON_MAX_LENGTH = 1000;
export const OVERTIME_REASON_MIN_LENGTH = 3;

const isoDate = z.iso.date({ error: "The date is missing. Reload the page." });

/** The gate's answer. The reason is optional for every member submission (WORKFLOWS §1, 2.1). */
export const submitChoiceSchema = z.object({
  choice: z.enum(ATTENDANCE_CHOICES, { error: "Choose one." }),
  reason: z
    .string()
    .trim()
    .max(ATTENDANCE_REASON_MAX_LENGTH, `Keep it under ${ATTENDANCE_REASON_MAX_LENGTH} characters.`)
    .optional()
    .transform((value) => (value ? value : null)),
  /** The IST date the screen was shown for: another date is refused ("The day changed"). */
  forDate: isoDate,
  next: z.string().max(2048).optional(),
});
export type SubmitChoiceInput = z.input<typeof submitChoiceSchema>;

/** "I'm working today" on an approved-leave day: `attendance_submit(present)`. */
export const workingTodaySchema = z.object({ forDate: isoDate });
export type WorkingTodayInput = z.input<typeof workingTodaySchema>;

/** Overtime is flagged "with a reason" (WORKFLOWS §1); a notice, no approval. */
export const flagOvertimeSchema = z.object({
  dayId: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(OVERTIME_REASON_MIN_LENGTH, "Please write a few more words.")
    .max(ATTENDANCE_REASON_MAX_LENGTH, `Keep it under ${ATTENDANCE_REASON_MAX_LENGTH} characters.`),
});
export type FlagOvertimeInput = z.input<typeof flagOvertimeSchema>;

/** The same reason rule, for today's own day (the Log out confirmation). */
export const flagOvertimeTodaySchema = flagOvertimeSchema.pick({ reason: true });
export type FlagOvertimeTodayInput = z.input<typeof flagOvertimeTodaySchema>;
