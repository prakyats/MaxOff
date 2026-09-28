import { formatIST, istDayStart } from "@/core/time";

import {
  type AttendanceChoice,
  type AttendanceState,
  CHOICE_COPY,
  type DayStatus,
  type LeaveType,
  STATUS_LABELS,
} from "./choices";
import { clockTime } from "./history";

/** Today's own attendance day, as the strip and the prompt need it (`attendance_own_today()`). */
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
  /** The Start day and End day taps (3b.1); null on a day recorded the 2.x way. */
  startedAt: string | null;
  endedAt: string | null;
  endNotRecorded: boolean;
  /** The 2.x sign-in time, still written by main's gate on the shared staging database. */
  firstLoginAt: string | null;
};

/** What `attendance_own_today()` answers: the day (or none) and what today is. */
export type OwnToday = {
  workDate: string;
  /** Attendance has begun: today is after the IST date of joining. */
  attendanceStarted: boolean;
  /** Not a weekly off day and not a holiday (unknown counts as working, as in the database). */
  isWorkingDay: boolean;
  day: TodayDay | null;
  /** Yesterday's day with a start and no end: the one End day would close after midnight. */
  yesterdayOpen: { dayId: string; startedAt: string } | null;
  /** Approved leave covering today while no row exists yet (a Start day would derive the row). */
  coveringLeaveType: LeaveType | null;
};

/**
 * The one action the strip offers (PRODUCT §4.2, kickoff 3b decisions 3, 4 and 6): Start day,
 * End day, "I'm working today" on full leave (a Start day the Owner reviews), or the day-off
 * note. The button's label is the action's name, so the strip reads "Not started · Start day".
 */
export type StripAction =
  | { kind: "start"; label: "Start day" }
  | { kind: "end"; label: "End day" }
  | { kind: "working"; label: "I'm working today" }
  | { kind: "worked_day_off"; label: "I worked today" };

/**
 * The one-line attendance strip on My Day and /today (the 2.3 polish, reworked in 3b.1):
 * `text` is where the day stands in the words the rest of the app uses, `dot` is the status the
 * dot's colour follows, `action` the one button beside it (or none). Pure, so it is unit-tested.
 */
export type TodayStrip = {
  kind:
    | "not_started"
    | "start"
    | "started"
    | "ended"
    | "on_leave"
    | "half_day"
    | "day_off"
    | "end_yesterday"
    | "status";
  text: string;
  dot: string;
  action: StripAction | null;
};

const START: StripAction = { kind: "start", label: "Start day" };
const END: StripAction = { kind: "end", label: "End day" };
const WORKING: StripAction = { kind: "working", label: "I'm working today" };
const WORKED_DAY_OFF: StripAction = { kind: "worked_day_off", label: "I worked today" };

const ON_LEAVE_TEXT: Record<LeaveType, string> = {
  leave: "On leave today",
  half_day: "Half day today",
  comp_leave: "On comp leave today",
};

/**
 * Whether the Start-day prompt is due at all today (before any snooze, `prompt.ts`): a working
 * day whose attendance has begun, with no Start day and no leave chosen yet. A day off never
 * prompts (decision 4), nor does a day derived from approved leave (PRODUCT §4.2), nor a day
 * already recorded (a 2.x gate choice on the shared staging database counts, decision 28).
 */
export function promptDue(today: OwnToday): boolean {
  if (!today.attendanceStarted || !today.isWorkingDay) return false;
  if (today.day === null) return today.coveringLeaveType === null;
  return today.day.state === "awaiting_choice" && !today.day.isDayOff;
}

/** "Started 9:12 am". */
function startedText(startedAt: string): string {
  return `Started ${clockTime(startedAt)}`;
}

export function describeTodayStrip(today: OwnToday): TodayStrip {
  const { day } = today;

  if (!today.attendanceStarted) {
    return { kind: "not_started", text: "Attendance starts tomorrow", dot: "none", action: null };
  }

  // Worked past midnight without ending: the open day is yesterday's, and End day closes it.
  if (day === null && today.yesterdayOpen) {
    return {
      kind: "end_yesterday",
      text: `Yesterday not ended · started ${clockTime(today.yesterdayOpen.startedAt)}`,
      dot: "pending_review",
      action: END,
    };
  }

  // Approved leave covering today, no row yet: the same offers as a derived day (below).
  if (day === null && today.coveringLeaveType !== null) {
    if (today.coveringLeaveType === "half_day") {
      return { kind: "half_day", text: ON_LEAVE_TEXT.half_day, dot: "half_day", action: START };
    }
    return {
      kind: "on_leave",
      text: ON_LEAVE_TEXT[today.coveringLeaveType],
      dot: today.coveringLeaveType,
      action: WORKING,
    };
  }

  if (day === null || (day.state === "awaiting_choice" && !day.isDayOff)) {
    if (!today.isWorkingDay) {
      return { kind: "day_off", text: "Day off", dot: "none", action: WORKED_DAY_OFF };
    }
    return { kind: "start", text: "Not started", dot: "awaiting_choice", action: START };
  }

  if (day.state === "awaiting_choice") {
    // A day-off row opened by the 2.x gate, no choice: nothing to record but the note.
    return { kind: "day_off", text: "Day off", dot: "none", action: WORKED_DAY_OFF };
  }

  if (
    day.state === "approved" &&
    day.proposedBySystem &&
    day.submittedChoice === null &&
    day.leaveType !== null
  ) {
    if (day.leaveType === "half_day") {
      // Start day and End day stay available on a half-day leave day (PRODUCT §4.2).
      return {
        kind: "half_day",
        text: day.startedAt
          ? `Half day today · ${day.endedAt ? `ended ${clockTime(day.endedAt)}` : startedText(day.startedAt).toLowerCase()}`
          : ON_LEAVE_TEXT.half_day,
        dot: day.leaveType,
        action: day.startedAt ? (day.endedAt ? null : END) : START,
      };
    }
    return {
      kind: "on_leave",
      text: ON_LEAVE_TEXT[day.leaveType],
      dot: day.leaveType,
      action: WORKING,
    };
  }

  const standing =
    day.state === "pending_review"
      ? "waiting for approval"
      : day.state === "approved"
        ? "approved"
        : day.decidedBySystem
          ? "your leave was approved"
          : "corrected by the Owner";
  const status =
    day.state === "pending_review"
      ? day.submittedChoice
        ? CHOICE_COPY[day.submittedChoice].label
        : `${STATUS_LABELS.absent} (proposed)`
      : day.finalStatus
        ? STATUS_LABELS[day.finalStatus]
        : "Recorded";
  const dot =
    day.state === "pending_review"
      ? day.state
      : day.state === "approved"
        ? (day.finalStatus ?? day.state)
        : day.state;
  const outcome = day.submittedChoice ?? day.finalStatus;

  // A working day of theirs (Present, or a half day): the strip carries the day's clock.
  if (outcome === "present" || outcome === "half_day") {
    if (day.endedAt) {
      return {
        kind: "ended",
        text: `${status} · ended ${clockTime(day.endedAt)} · ${standing}`,
        dot,
        action: null,
      };
    }
    if (day.startedAt) {
      return {
        kind: "started",
        text: `${startedText(day.startedAt)} · ${standing}`,
        dot,
        action: END,
      };
    }
    // Present recorded without a Start day (a 2.x gate choice on the shared staging database):
    // the start can still be recorded, and End day needs it (decision 28).
    return {
      kind: "status",
      text: `${status} · ${standing}`,
      dot,
      action: day.state === "corrected" && day.finalStatus !== "present" ? null : START,
    };
  }

  return { kind: "status", text: `${status} · ${standing}`, dot, action: null };
}

/** "Wednesday, 23 September" for an IST date (the heading of the prompt and the history). */
export function dayLabel(date: string): string {
  return formatIST(istDayStart(date), "EEEE, d MMMM");
}
