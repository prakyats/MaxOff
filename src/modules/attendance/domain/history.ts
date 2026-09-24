import { formatIST, istDayStart } from "@/core/time";

import {
  type AttendanceChoice,
  type AttendanceState,
  type DayStatus,
  STATUS_LABELS,
} from "./choices";

/** `attendance_events.action` (DATA-MODEL §3). */
export const ATTENDANCE_EVENT_ACTIONS = [
  "submitted",
  "proposed_absent",
  "derived_from_leave",
  "approved",
  "corrected",
  "logout",
  "overtime_flagged",
] as const;
export type AttendanceEventAction = (typeof ATTENDANCE_EVENT_ACTIONS)[number];

export function isEventAction(value: string): value is AttendanceEventAction {
  return (ATTENDANCE_EVENT_ACTIONS as readonly string[]).includes(value);
}

/** Who wrote an event, from the member's side: themselves, the Owner, or MaxOff itself. */
export type EventActor = "you" | "owner" | "system";

export type HistoryEvent = {
  id: number;
  action: AttendanceEventAction;
  fromStatus: DayStatus | null;
  toStatus: DayStatus | null;
  reason: string | null;
  actor: EventActor;
  at: string;
};

/** One of the member's own attendance days, as the history needs it (`data/attendance.ts`). */
export type HistoryDay = {
  id: string;
  workDate: string;
  state: AttendanceState;
  submittedChoice: AttendanceChoice | null;
  finalStatus: DayStatus | null;
  isDayOff: boolean;
  workedOnLeave: boolean;
  firstLoginAt: string | null;
  lastLogoutAt: string | null;
  logoutNotRecorded: boolean;
  overtimeFlag: boolean;
  overtimeReason: string | null;
  events: HistoryEvent[];
};

/** The reasons the transition functions write when MaxOff itself changes a day (2.1, 2.2). */
const LEAVE_APPROVED = "leave approved";
const LEAVE_CANCELLED = "leave cancelled";

const lower = (status: DayStatus) => STATUS_LABELS[status].toLowerCase();

export function eventActor(actorId: string | null, memberId: string): EventActor {
  if (actorId === null) return "system";
  return actorId === memberId ? "you" : "owner";
}

/**
 * One line of a day's history, **in the member's words, not the database's** (owner decision
 * 2026-09-24): a system correction reads "Changed to leave: your leave request was approved",
 * never "corrected by system". `note` is the reason that came with it, when there was one.
 */
export function describeEvent(event: HistoryEvent): { text: string; note: string | null } {
  const to = event.toStatus;
  switch (event.action) {
    case "submitted":
      return {
        text:
          event.fromStatus !== null && to === "present"
            ? "You said you're working on a day of approved leave"
            : to
              ? `You chose ${lower(to)}`
              : "You chose",
        note: event.reason ? `Your note: ${event.reason}` : null,
      };
    case "approved":
      return { text: to ? `The Owner approved ${lower(to)}` : "The Owner approved it", note: null };
    case "corrected":
      if (event.actor === "system") {
        if (event.reason === LEAVE_APPROVED && to) {
          return { text: `Changed to ${lower(to)}: your leave request was approved`, note: null };
        }
        if (event.reason === LEAVE_CANCELLED || to === null) {
          return {
            text: "Your leave was cancelled, so the day asked for a choice again",
            note: null,
          };
        }
        return { text: `Changed to ${lower(to)}`, note: event.reason };
      }
      return {
        text: to ? `The Owner changed it to ${lower(to)}` : "The Owner changed it",
        note: event.reason ? `The Owner's reason: ${event.reason}` : null,
      };
    case "derived_from_leave":
      return {
        text: to ? `${STATUS_LABELS[to]} from your approved leave` : "From your approved leave",
        note: null,
      };
    case "proposed_absent":
      return { text: "No attendance was chosen, so absent was proposed for the Owner", note: null };
    case "logout":
      return { text: "Logged out", note: null };
    case "overtime_flagged":
      return {
        text: "You flagged overtime",
        note: event.reason ? `Your note: ${event.reason}` : null,
      };
  }
}

export type HistoryDaySummary = {
  /** "Present", "Absent (proposed)", "Not chosen". */
  status: string;
  /** Where it stands: "Approved", "Waiting for the Owner", "Changed by the Owner"… */
  standing: string;
  /** What the dot's colour follows: the outcome once decided, the waiting state before. */
  dotStatus: string;
  /** Short flags worth seeing without opening the day. */
  flags: string[];
};

export function describeHistoryDay(day: HistoryDay): HistoryDaySummary {
  const flags: string[] = [];
  const worked = (day.finalStatus ?? day.submittedChoice) === "present";
  if (day.isDayOff && worked) flags.push("Worked on a day off");
  if (day.workedOnLeave) flags.push("1 day worked");
  if (day.overtimeFlag) flags.push("Overtime");
  if (day.logoutNotRecorded) flags.push("Logout not recorded");

  if (day.state === "awaiting_choice") {
    return { status: "Not chosen", standing: "No choice made", dotStatus: day.state, flags };
  }
  if (day.state === "pending_review") {
    const status = day.submittedChoice
      ? STATUS_LABELS[day.submittedChoice]
      : `${STATUS_LABELS.absent} (proposed)`;
    return { status, standing: "Waiting for the Owner", dotStatus: day.state, flags };
  }

  const status = day.finalStatus ? STATUS_LABELS[day.finalStatus] : "Recorded";
  const last = [...day.events].reverse().find((event) => event.action === "corrected");
  const standing =
    day.state === "approved"
      ? "Approved"
      : last?.actor === "system"
        ? "Your leave was approved"
        : "Changed by the Owner";
  return { status, standing, dotStatus: day.finalStatus ?? day.state, flags };
}

/** "Wed, 23 Sep": a history row's date. */
export function historyDate(date: string): string {
  return formatIST(istDayStart(date), "EEE, d MMM");
}

/** "9:12 am", the IST clock time of an instant. */
export function clockTime(instant: string): string {
  return formatIST(instant, "h:mm aaa");
}
