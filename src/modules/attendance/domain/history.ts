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
 * Whose eyes the history is read through. The member reads their own ("You chose leave", "The
 * Owner's reason: …"); the Owner reads someone else's in the same words turned around ("Asha
 * chose leave", "Your reason: …"), so there is one vocabulary, not two (2.4).
 */
export type Viewpoint = { kind: "self" } | { kind: "owner"; name: string };
export const SELF: Viewpoint = { kind: "self" };

type Words = {
  /** The person the day belongs to, as a sentence subject: "You" / "Asha". */
  who: string;
  /** Their pronoun in "they're working": "you're" / "they're". */
  theyAre: string;
  /** "your" / "their". */
  their: string;
  /** Prefix of the person's own note. */
  theirNote: string;
  /** The Owner, as a sentence subject: "The Owner" / "You". */
  owner: string;
  /** Prefix of the Owner's reason. */
  ownerReason: string;
  waiting: string;
  changed: string;
  leaveApproved: string;
};

function words(viewpoint: Viewpoint): Words {
  if (viewpoint.kind === "self") {
    return {
      who: "You",
      theyAre: "you're",
      their: "your",
      theirNote: "Your note",
      owner: "The Owner",
      ownerReason: "The Owner's reason",
      waiting: "Waiting for the Owner",
      changed: "Changed by the Owner",
      leaveApproved: "Your leave was approved",
    };
  }
  const first = firstName(viewpoint.name);
  return {
    who: first,
    theyAre: "they're",
    their: "their",
    theirNote: `${first}'s note`,
    owner: "You",
    ownerReason: "Your reason",
    waiting: "Waiting for you",
    changed: "Changed by you",
    leaveApproved: "Leave approved",
  };
}

/** "Asha" from "Asha Rao": what the Owner's screens call a person in a sentence. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * One line of a day's history, **in the member's words, not the database's** (owner decision
 * 2026-09-24): a system correction reads "Changed to leave: your leave request was approved",
 * never "corrected by system". `note` is the reason that came with it, when there was one.
 */
export function describeEvent(
  event: HistoryEvent,
  viewpoint: Viewpoint = SELF,
): { text: string; note: string | null } {
  const w = words(viewpoint);
  const to = event.toStatus;
  switch (event.action) {
    case "submitted":
      return {
        text:
          event.fromStatus !== null && to === "present"
            ? `${w.who} said ${w.theyAre} working on a day of approved leave`
            : to
              ? `${w.who} chose ${lower(to)}`
              : `${w.who} chose`,
        note: event.reason ? `${w.theirNote}: ${event.reason}` : null,
      };
    case "approved":
      return {
        text: to ? `${w.owner} approved ${lower(to)}` : `${w.owner} approved it`,
        note: null,
      };
    case "corrected":
      if (event.actor === "system") {
        if (event.reason === LEAVE_APPROVED && to) {
          return {
            text: `Changed to ${lower(to)}: ${w.their} leave request was approved`,
            note: null,
          };
        }
        if (event.reason === LEAVE_CANCELLED || to === null) {
          return {
            text: `${capitalise(w.their)} leave was cancelled, so the day asked for a choice again`,
            note: null,
          };
        }
        return { text: `Changed to ${lower(to)}`, note: event.reason };
      }
      return {
        text: to ? `${w.owner} changed it to ${lower(to)}` : `${w.owner} changed it`,
        note: event.reason ? `${w.ownerReason}: ${event.reason}` : null,
      };
    case "derived_from_leave":
      return {
        text: to
          ? `${STATUS_LABELS[to]} from ${w.their} approved leave`
          : `From ${w.their} approved leave`,
        note: null,
      };
    case "proposed_absent":
      return {
        text:
          viewpoint.kind === "self"
            ? "No attendance was chosen, so absent was proposed for the Owner"
            : "No attendance was chosen, so absent was proposed",
        note: null,
      };
    case "logout":
      return { text: "Logged out", note: null };
    case "overtime_flagged":
      return {
        text: `${w.who} flagged overtime`,
        note: event.reason ? `${w.theirNote}: ${event.reason}` : null,
      };
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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

export function describeHistoryDay(
  day: HistoryDay,
  viewpoint: Viewpoint = SELF,
): HistoryDaySummary {
  const w = words(viewpoint);
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
    return { status, standing: w.waiting, dotStatus: day.state, flags };
  }

  const status = day.finalStatus ? STATUS_LABELS[day.finalStatus] : "Recorded";
  const last = [...day.events].reverse().find((event) => event.action === "corrected");
  const standing =
    day.state === "approved" ? "Approved" : last?.actor === "system" ? w.leaveApproved : w.changed;
  return { status, standing, dotStatus: day.finalStatus ?? day.state, flags };
}

/**
 * Overtime can be flagged on today's own day, once (a second call would only replace the
 * reason; the Log out confirmation is where a late note is added). The strip on the home
 * screen is one line, so today's entry in the history carries the action (2.3 polish).
 */
export function canFlagOvertime(
  day: Pick<HistoryDay, "workDate" | "overtimeFlag">,
  today: string,
): boolean {
  return day.workDate === today && !day.overtimeFlag;
}

/** "Wed, 23 Sep": a history row's date. */
export function historyDate(date: string): string {
  return formatIST(istDayStart(date), "EEE, d MMM");
}

/** "9:12 am", the IST clock time of an instant. */
export function clockTime(instant: string): string {
  return formatIST(instant, "h:mm aaa");
}
