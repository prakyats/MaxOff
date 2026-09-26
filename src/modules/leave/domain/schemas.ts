import { z } from "zod";

import { addISTDays } from "@/core/time";

import { LEAVE_MAX_DAYS, LEAVE_REASON_MAX_LENGTH, OWNER_REASON_MIN_LENGTH } from "./limits";

import { LEAVE_TYPES } from "./requests";

const reason = z
  .string()
  .trim()
  .max(LEAVE_REASON_MAX_LENGTH, `Keep it under ${LEAVE_REASON_MAX_LENGTH} characters.`)
  .optional()
  .transform((value) => (value ? value : null));

const isoDate = (message: string) => z.iso.date({ error: message });

/**
 * The date rules of WORKFLOWS §2, as the form can check them before the database does (it
 * checks them again, and it is the rule): the end is not before the start, a half day is one
 * date (the form sends no end date for it), a request covers at most `LEAVE_MAX_DAYS`, a new
 * request starts today or later, and a change may keep its original start but must end today or
 * later.
 */
function leaveDatesSchema(today: string, keepStart: string | null) {
  return z
    .object({
      type: z.enum(LEAVE_TYPES, { error: "Choose the kind of leave." }),
      startDate: isoDate("Choose the first day."),
      endDate: isoDate("Choose the last day.").optional(),
      reason,
    })
    .transform((value) => ({
      ...value,
      endDate: value.type === "half_day" || !value.endDate ? value.startDate : value.endDate,
    }))
    .superRefine((value, ctx) => {
      if (value.startDate < today && value.startDate !== keepStart) {
        ctx.addIssue({
          code: "custom",
          path: ["startDate"],
          message: "Leave cannot start in the past.",
        });
      }
      if (value.endDate < value.startDate) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "The last day is before the first day.",
        });
      } else if (value.endDate > addISTDays(value.startDate, LEAVE_MAX_DAYS - 1)) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: `Leave can cover at most ${LEAVE_MAX_DAYS} days.`,
        });
      } else if (keepStart !== null && value.endDate < today) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "The changed leave must end today or later.",
        });
      }
    });
}

/** A new request (`leave_submit`). `today` is the IST date (`todayIST()`), passed in. */
export function requestLeaveSchema(today: string) {
  return leaveDatesSchema(today, null);
}
export type RequestLeaveInput = z.input<ReturnType<typeof requestLeaveSchema>>;

/**
 * A change to approved leave (`leave_request_change`). `originalStart` only lets the form
 * accept a start that has already passed when it is the original's own; the database checks
 * it against the real row.
 */
export function changeLeaveSchema(today: string, originalStart: string) {
  return leaveDatesSchema(today, originalStart);
}
export type ChangeLeaveInput = z.input<ReturnType<typeof changeLeaveSchema>> & {
  requestId: string;
  originalStart: string;
};

/** The request a change, cancellation or withdrawal refers to. */
export const requestIdSchema = z.object({
  requestId: z.uuid(),
  originalStart: z.iso.date().optional(),
});

/** Asking the Owner to cancel approved leave. The reason is optional (WORKFLOWS §1, 2.1). */
export const cancelLeaveSchema = z.object({ requestId: z.uuid(), reason });
export type CancelLeaveInput = z.input<typeof cancelLeaveSchema>;

/** Withdrawing a request that is still waiting. */
export const withdrawLeaveSchema = z.object({ requestId: z.uuid() });
export type WithdrawLeaveInput = z.input<typeof withdrawLeaveSchema>;

// The Owner's decisions (task 2.4) -----------------------------------------------------------

/** A reason the Owner must give (reject, cancel): the member reads it on /leave. */
const ownerReason = z
  .string()
  .trim()
  .min(OWNER_REASON_MIN_LENGTH, "Please write a few more words.")
  .max(LEAVE_REASON_MAX_LENGTH, `Keep it under ${LEAVE_REASON_MAX_LENGTH} characters.`);

/** Approve one request. Approve never asks for a reason (PRODUCT "Approvals"). */
export const approveLeaveSchema = z.object({ requestId: z.uuid() });
export type ApproveLeaveInput = z.input<typeof approveLeaveSchema>;

/** "Approve all N": only the ids that were on screen, one call each (WORKFLOWS §1). */
export const approveLeavesSchema = z.object({
  requestIds: z
    .array(z.uuid())
    .min(1, "Nothing to approve.")
    .max(200, "Approve at most 200 at once."),
});
export type ApproveLeavesInput = z.input<typeof approveLeavesSchema>;

export const rejectLeaveSchema = z.object({ requestId: z.uuid(), reason: ownerReason });
export type RejectLeaveInput = z.input<typeof rejectLeaveSchema>;

export const ownerCancelLeaveSchema = z.object({ requestId: z.uuid(), reason: ownerReason });
export type OwnerCancelLeaveInput = z.input<typeof ownerCancelLeaveSchema>;

/**
 * The Owner's edit of approved leave (`leave_owner_edit`): any dates, past included (WORKFLOWS
 * §2), so only the order of the ends is checked here. The reason is optional, as in the function.
 */
export const ownerEditLeaveSchema = z
  .object({
    requestId: z.uuid(),
    type: z.enum(LEAVE_TYPES, { error: "Choose the kind of leave." }),
    startDate: isoDate("Choose the first day."),
    endDate: isoDate("Choose the last day.").optional(),
    reason,
  })
  .transform((value) => ({
    ...value,
    endDate: value.type === "half_day" || !value.endDate ? value.startDate : value.endDate,
  }))
  .refine((value) => value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "The last day is before the first day.",
  });
export type OwnerEditLeaveInput = z.input<typeof ownerEditLeaveSchema>;

export { LEAVE_REASON_MAX_LENGTH, OWNER_REASON_MIN_LENGTH };
