import { z } from "zod";

import { ATTENDANCE_REASON_MAX_LENGTH, OVERTIME_REASON_MIN_LENGTH } from "./limits";

import { DAY_STATUSES, PROMPT_LEAVE_CHOICES } from "./choices";
import { DURATION_OPTIONS, EXTRA_WORK_KINDS, NOTE_DECISIONS } from "./notes";

const isoDate = z.iso.date({ error: "The date is missing. Reload the page." });

/**
 * The Start-day prompt's "On leave today? Choose leave" (3b.1): Leave or Half day, an optional
 * reason (WORKFLOWS §1, 2.1). Comp leave is requested from the leave form (decision 16).
 */
export const chooseLeaveTodaySchema = z.object({
  choice: z.enum(PROMPT_LEAVE_CHOICES, { error: "Choose Leave or Half day." }),
  reason: z
    .string()
    .trim()
    .max(ATTENDANCE_REASON_MAX_LENGTH, `Keep it under ${ATTENDANCE_REASON_MAX_LENGTH} characters.`)
    .optional()
    .transform((value) => (value ? value : null)),
});
export type ChooseLeaveTodayInput = z.input<typeof chooseLeaveTodaySchema>;

/**
 * An extra work note (PRODUCT §4.3a, 3b.2): the day (one of the last 8, the database checks the
 * window), its kind by the calendar, a rough duration for overtime, and what they worked on.
 */
export const submitNoteSchema = z.object({
  kind: z.enum(EXTRA_WORK_KINDS, { error: "Pick the day." }),
  workDate: isoDate,
  durationMinutes: z
    .union([z.literal(null), ...DURATION_OPTIONS.map((minutes) => z.literal(minutes))])
    .default(null),
  note: z
    .string()
    .trim()
    .min(OVERTIME_REASON_MIN_LENGTH, "Say what you worked on.")
    .max(ATTENDANCE_REASON_MAX_LENGTH, `Keep it under ${ATTENDANCE_REASON_MAX_LENGTH} characters.`),
});
export type SubmitNoteInput = z.input<typeof submitNoteSchema>;

/** The Owner's decision on a note (decision 12): grant ½ or 1 day, or none; a day off worked. */
export const decideNoteSchema = z.object({
  noteId: z.uuid(),
  decision: z.enum(NOTE_DECISIONS, { error: "Choose what the note earns." }),
  markDayWorked: z.boolean().default(false),
  note: z
    .string()
    .trim()
    .max(ATTENDANCE_REASON_MAX_LENGTH, `Keep it under ${ATTENDANCE_REASON_MAX_LENGTH} characters.`)
    .optional()
    .transform((value) => (value ? value : null)),
});
export type DecideNoteInput = z.input<typeof decideNoteSchema>;

/** End day (3b.1) with the confirmation's optional overtime note (3b.2). */
export const endDaySchema = z.object({
  // Empty means "no note"; a note that is there says what they worked on, as on the Extra work tab.
  overtimeNote: z
    .string()
    .trim()
    .max(ATTENDANCE_REASON_MAX_LENGTH, `Keep it under ${ATTENDANCE_REASON_MAX_LENGTH} characters.`)
    .refine((value) => value === "" || value.length >= OVERTIME_REASON_MIN_LENGTH, {
      message: "Say what you worked on.",
    })
    .optional()
    .transform((value) => (value ? value : null)),
  overtimeMinutes: z
    .union([z.literal(null), ...DURATION_OPTIONS.map((minutes) => z.literal(minutes))])
    .default(null),
});
export type EndDayInput = z.input<typeof endDaySchema>;

/** Owner review (2.4): approve one day. Approve never asks for a reason (PRODUCT "Approvals"). */
export const approveDaySchema = z.object({ dayId: z.uuid() });
export type ApproveDayInput = z.input<typeof approveDaySchema>;

/** "Approve all N": only the ids that were on screen, one call each (WORKFLOWS §1). */
export const approveDaysSchema = z.object({
  dayIds: z.array(z.uuid()).min(1, "Nothing to approve.").max(200, "Approve at most 200 at once."),
});
export type ApproveDaysInput = z.input<typeof approveDaysSchema>;

/** A correction always asks for a reason, which the member reads (owner decision 2026-09-24). */
export const correctDaySchema = z.object({
  dayId: z.uuid(),
  status: z.enum(DAY_STATUSES, { error: "Choose what the day should be." }),
  reason: z
    .string()
    .trim()
    .min(OVERTIME_REASON_MIN_LENGTH, "Please write a few more words.")
    .max(ATTENDANCE_REASON_MAX_LENGTH, `Keep it under ${ATTENDANCE_REASON_MAX_LENGTH} characters.`),
});
export type CorrectDayInput = z.input<typeof correctDaySchema>;

export { ATTENDANCE_REASON_MAX_LENGTH, OVERTIME_REASON_MIN_LENGTH };
