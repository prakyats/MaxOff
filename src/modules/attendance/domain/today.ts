import { formatIST, istDayStart } from "@/core/time";

import {
  type AttendanceChoice,
  type AttendanceState,
  CHOICE_COPY,
  type DayStatus,
  type LeaveType,
  STATUS_LABELS,
} from "./choices";

/** Today's own attendance day, as the strip needs it (`data/attendance.ts`). */
export type TodayDay = {
  id: string;
  workDate: string;
  state: AttendanceState;
  submittedChoice: AttendanceChoice | null;
  finalStatus: DayStatus | null;
  isDayOff: boolean;
  proposedBySystem: boolean;
  decidedBySystem: boolean;
  decisionReason: string | null;
  workedOnLeave: boolean;
  overtimeFlag: boolean;
  overtimeReason: string | null;
  leaveType: LeaveType | null;
};

/**
 * The one-line attendance strip on My Day and /today (the 2.3 polish; PRODUCT §4.10: My Day is
 * mainly tasks). `text` is "status · standing" in the words the rest of the app uses
 * (`STATUS_LABELS`, `CHOICE_COPY`); `dot` is the status the dot's colour follows. Pure, so it
 * is unit-tested.
 */
export type TodayStrip =
  /** No day: the joining day (attendance starts tomorrow). */
  | { kind: "not_started"; text: string; dot: string }
  /** Logged in, no choice yet (e.g. a leave cancelled today handed the day back to the gate). */
  | { kind: "choose"; text: string; dot: string }
  /**
   * Approved leave derived the day: no gate, and the "I'm working" offer (PRODUCT §4.2: the
   * banner's optional button stays on the strip).
   */
  | {
      kind: "on_leave";
      text: string;
      dot: string;
      workingLabel: "I'm working today" | "I'm working the full day";
    }
  | { kind: "status"; text: string; dot: string };

const ON_LEAVE_TEXT: Record<LeaveType, string> = {
  leave: "On leave today",
  half_day: "Half day today",
  comp_leave: "On comp leave today",
};

export function describeTodayStrip(day: TodayDay | null): TodayStrip {
  if (!day) return { kind: "not_started", text: "Attendance starts tomorrow", dot: "none" };

  if (day.state === "awaiting_choice") {
    return { kind: "choose", text: "Not chosen yet · choose now", dot: day.state };
  }

  if (
    day.state === "approved" &&
    day.proposedBySystem &&
    day.submittedChoice === null &&
    day.leaveType !== null
  ) {
    return {
      kind: "on_leave",
      text: ON_LEAVE_TEXT[day.leaveType],
      dot: day.leaveType,
      workingLabel: day.leaveType === "half_day" ? "I'm working the full day" : "I'm working today",
    };
  }

  if (day.state === "pending_review") {
    const status = day.submittedChoice
      ? CHOICE_COPY[day.submittedChoice].label
      : `${STATUS_LABELS.absent} (proposed)`;
    return { kind: "status", text: `${status} · waiting for approval`, dot: day.state };
  }

  const status = day.finalStatus ? STATUS_LABELS[day.finalStatus] : "Recorded";
  const standing =
    day.state === "approved"
      ? "approved"
      : day.decidedBySystem
        ? "your leave was approved"
        : "corrected by the Owner";
  return {
    kind: "status",
    text: `${status} · ${standing}`,
    dot: day.state === "approved" ? (day.finalStatus ?? day.state) : day.state,
  };
}

/** "Wednesday, 23 September" for an IST date (the heading of the gate and the card). */
export function dayLabel(date: string): string {
  return formatIST(istDayStart(date), "EEEE, d MMMM");
}
