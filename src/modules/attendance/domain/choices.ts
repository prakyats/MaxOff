import type { Enums } from "@/core/db";

import { daysLabel } from "./comp-days";

export type AttendanceChoice = Enums<"attendance_choice">;
export type DayStatus = Enums<"day_status">;
export type AttendanceState = Enums<"attendance_state">;
export type LeaveType = Enums<"leave_type">;

/**
 * The leave the Start-day prompt offers (PRODUCT §4.2, kickoff 3b decision 3): Leave or Half
 * day. Comp leave is requested only from the leave form, with a credit (decision 16), and
 * Present is Start day itself; `attendance_choose_leave_today()` refuses both.
 */
export const PROMPT_LEAVE_CHOICES = [
  "leave",
  "half_day",
] as const satisfies readonly AttendanceChoice[];
export type PromptLeaveChoice = (typeof PROMPT_LEAVE_CHOICES)[number];

export const CHOICE_COPY: Record<AttendanceChoice, { label: string; hint: string }> = {
  present: { label: "Present", hint: "I'm working today." },
  leave: { label: "Leave", hint: "The whole day off." },
  half_day: { label: "Half day", hint: "Half the day off." },
  comp_leave: { label: "Comp leave", hint: "A day off in return for extra work." },
};

/** What the Owner can set a day to, in the order the correction dialog lists them. */
export const DAY_STATUSES = [
  "present",
  "absent",
  "leave",
  "half_day",
  "comp_leave",
] as const satisfies readonly DayStatus[];

export const STATUS_LABELS: Record<DayStatus, string> = {
  present: "Present",
  leave: "Leave",
  half_day: "Half day",
  comp_leave: "Comp leave",
  absent: "Absent",
};

/**
 * Whether the Owner's correction dialog offers comp leave (3c review): the correction draws one
 * of the person's credits (`attendance_decide`, kickoff 3b decision 16), so with none it is
 * greyed out and the hint says what to do. `compDays` is the person's balance today, or `null`
 * where the screen does not know it (Approvals, many members: the database's refusal shows in the
 * dialog's alert then). A day whose approved leave already is comp leave stays choosable:
 * correcting it to comp leave again creates nothing and uses no credit.
 */
export function compLeaveOption(
  compDays: number | null,
  leaveType: DayStatus | null,
  name: string,
): { disabled: boolean; hint: string | null } {
  if (leaveType === "comp_leave") {
    return {
      disabled: false,
      hint: `${name}'s day is already comp leave, so no new credit is used.`,
    };
  }
  if (compDays === null) return { disabled: false, hint: null };
  if (compDays <= 0) {
    return {
      disabled: true,
      hint: `${name} has no comp leave credit: grant one first from their Leave tab.`,
    };
  }
  return { disabled: false, hint: `${name} has ${daysLabel(compDays)} of comp leave.` };
}
