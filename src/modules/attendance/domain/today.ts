import { formatIST, istDayStart } from "@/core/time";

import {
  type AttendanceChoice,
  type AttendanceState,
  CHOICE_COPY,
  type DayStatus,
  type LeaveType,
  STATUS_LABELS,
} from "./choices";

/** Today's own attendance day, as the card needs it (`data/attendance.ts`). */
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

/** What the attendance card says and offers (WORKFLOWS §1). Pure, so it is unit-tested. */
export type TodayView =
  /** No day: the joining day (attendance starts tomorrow). */
  | { kind: "not_started" }
  /** Logged in, no choice yet (e.g. a leave cancelled today handed the day back to the gate). */
  | { kind: "choose"; dayOff: boolean }
  /** Approved leave derived the day: no gate, and the "I'm working" offer. */
  | {
      kind: "on_leave";
      leaveType: LeaveType;
      title: string;
      workingLabel: "I'm working today" | "I'm working the full day";
      dayOff: boolean;
    }
  | {
      kind: "status";
      /** The workflow state, for the badge. */
      state: AttendanceState;
      title: string;
      detail: string | null;
      dayOff: boolean;
    };

const LEAVE_TITLES: Record<LeaveType, string> = {
  leave: "You're on approved leave today",
  half_day: "You're on an approved half day today",
  comp_leave: "You're on approved comp leave today",
};

export function describeToday(day: TodayDay | null): TodayView {
  if (!day) return { kind: "not_started" };
  const dayOff = day.isDayOff;

  if (day.state === "awaiting_choice") return { kind: "choose", dayOff };

  if (
    day.state === "approved" &&
    day.proposedBySystem &&
    day.submittedChoice === null &&
    day.leaveType !== null
  ) {
    return {
      kind: "on_leave",
      leaveType: day.leaveType,
      title: LEAVE_TITLES[day.leaveType],
      workingLabel: day.leaveType === "half_day" ? "I'm working the full day" : "I'm working today",
      dayOff,
    };
  }

  const worked = dayOff && (day.finalStatus ?? day.submittedChoice) === "present";

  if (day.state === "pending_review") {
    const title = day.submittedChoice
      ? `${CHOICE_COPY[day.submittedChoice].label}, waiting for approval`
      : "No choice recorded: proposed absent, waiting for review";
    const detail = worked
      ? "Worked on a day off."
      : day.leaveType && day.submittedChoice === "present"
        ? "You said you're working on a day of approved leave."
        : null;
    return { kind: "status", state: day.state, title, detail, dayOff };
  }

  const status = day.finalStatus ? STATUS_LABELS[day.finalStatus] : "Recorded";
  const title = day.state === "approved" ? `${status}, approved` : `${status}, corrected`;
  const detail = worked
    ? "Worked on a day off."
    : day.workedOnLeave
      ? "Worked on a day of approved leave."
      : day.state === "corrected" && day.decisionReason
        ? day.decidedBySystem
          ? `Updated: ${day.decisionReason}.`
          : `The Owner's note: ${day.decisionReason}`
        : null;
  return { kind: "status", state: day.state, title, detail, dayOff };
}

/** "Wednesday, 23 September" for an IST date (the heading of the gate and the card). */
export function dayLabel(date: string): string {
  return formatIST(istDayStart(date), "EEEE, d MMMM");
}
