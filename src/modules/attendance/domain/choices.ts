import type { Enums } from "@/core/db";

export type AttendanceChoice = Enums<"attendance_choice">;
export type DayStatus = Enums<"day_status">;
export type AttendanceState = Enums<"attendance_state">;
export type LeaveType = Enums<"leave_type">;

/** The four answers of the gate, in the order the screen shows them (PRODUCT §4.2). */
export const ATTENDANCE_CHOICES = [
  "present",
  "leave",
  "half_day",
  "comp_leave",
] as const satisfies readonly AttendanceChoice[];

export const CHOICE_COPY: Record<AttendanceChoice, { label: string; hint: string }> = {
  present: { label: "Present", hint: "I'm working today." },
  leave: { label: "Leave", hint: "The whole day off." },
  half_day: { label: "Half day", hint: "Half the day off." },
  comp_leave: { label: "Comp leave", hint: "A day off in return for extra work." },
};

export const STATUS_LABELS: Record<DayStatus, string> = {
  present: "Present",
  leave: "Leave",
  half_day: "Half day",
  comp_leave: "Comp leave",
  absent: "Absent",
};

/** The message `attendance_submit()` sends when the gate screen was shown for another date. */
export const DAY_CHANGED_MESSAGE = "The day changed. Choose again for today.";
