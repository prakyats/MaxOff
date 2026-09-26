import type { Enums } from "@/core/db";
import { formatIST, istDayStart } from "@/core/time";

export type LeaveType = Enums<"leave_type">;
export type LeaveState = Enums<"leave_state">;
/** Where a request came from (DATA-MODEL §3): the form, the day gate, or the Owner's own edit. */
export type LeaveSource = "form" | "attendance" | "owner";

export const LEAVE_TYPES = [
  "leave",
  "half_day",
  "comp_leave",
] as const satisfies readonly LeaveType[];
export const LEAVE_STATES = [
  "submitted",
  "approved",
  "rejected",
  "withdrawn",
  "superseded",
  "cancelled",
] as const satisfies readonly LeaveState[];
export const LEAVE_SOURCES = [
  "form",
  "attendance",
  "owner",
] as const satisfies readonly LeaveSource[];

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  leave: "Leave",
  half_day: "Half day",
  comp_leave: "Comp leave",
};

/** The member's words for a request's state, not the database's. */
export const LEAVE_STATE_LABELS: Record<LeaveState, string> = {
  submitted: "Waiting",
  approved: "Approved",
  rejected: "Not approved",
  withdrawn: "Withdrawn",
  superseded: "Replaced",
  cancelled: "Cancelled",
};

/** One of the member's own requests, as the Requests tab needs it (`data/leave.ts`). */
export type OwnLeaveRequest = {
  id: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
  state: LeaveState;
  source: LeaveSource;
  supersedesId: string | null;
  requestsCancellation: boolean;
  decisionReason: string | null;
  createdAt: string;
  /** The request this one changes or cancels, when it does. */
  original: { type: LeaveType; startDate: string; endDate: string } | null;
  /** A change or cancellation of this request is waiting for the Owner. */
  hasOpenChange: boolean;
};

export type LeaveRequestActions = { withdraw: boolean; change: boolean; cancel: boolean };

/**
 * What the member may do with one of their own requests. **It mirrors the SQL exactly**
 * (`leave_withdraw`, `leave_request_change`, WORKFLOWS §2), so the screen never offers an
 * action the database refuses:
 * - withdraw: a request still waiting, **never** a gate request (`source = attendance`): the
 *   attendance day is its single door, and the Owner decides it with the day;
 * - change / cancel: approved leave of any source (form, gate or the Owner's edit) that has not
 *   ended (`end_date >= today`, IST; ongoing leave counts), unless a change or cancellation of
 *   it is already waiting (one open change per request). Leave that has fully passed is the
 *   Owner's to correct, through the attendance day (owner decision 2026-09-24).
 * Whether the member is active and holds `attendance.self` is the page's check, not this one.
 */
export function leaveRequestActions(
  request: Pick<OwnLeaveRequest, "state" | "source" | "hasOpenChange" | "endDate">,
  today: string,
): LeaveRequestActions {
  const withdraw = request.state === "submitted" && request.source !== "attendance";
  const changeable =
    request.state === "approved" && request.endDate >= today && !request.hasOpenChange;
  return { withdraw, change: changeable, cancel: changeable };
}

/** What `leave_request_change` answers for approved leave that has fully passed (2.3). */
export const LEAVE_ENDED_MESSAGE = "This leave has ended. Ask the Owner to correct it.";

/** Approved leave whose last day is before today (IST): the member can no longer change it. */
export function leaveHasEnded(
  request: Pick<OwnLeaveRequest, "state" | "endDate">,
  today: string,
): boolean {
  return request.state === "approved" && request.endDate < today;
}

/** "12 Oct" or "12 – 14 Oct 2026": one date for a single day, both ends for a range. */
export function leaveDates(startDate: string, endDate: string): string {
  const start = istDayStart(startDate);
  if (startDate === endDate) return formatIST(start, "EEE, d MMM yyyy");
  const end = istDayStart(endDate);
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  return `${formatIST(start, sameYear ? "d MMM" : "d MMM yyyy")} – ${formatIST(end, "d MMM yyyy")}`;
}

/** Calendar days a request covers, both ends included (a half day is one date). */
export function leaveDayCount(startDate: string, endDate: string): number {
  const days = Math.round(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
  );
  return days + 1;
}

/** "Leave · 3 days", "Half day", "Comp leave · 1 day". */
export function leaveTitle(
  request: Pick<OwnLeaveRequest, "type" | "startDate" | "endDate">,
): string {
  if (request.type === "half_day") return LEAVE_TYPE_LABELS.half_day;
  const count = leaveDayCount(request.startDate, request.endDate);
  return `${LEAVE_TYPE_LABELS[request.type]} · ${count} ${count === 1 ? "day" : "days"}`;
}

/**
 * The line that says what kind of request this is, in the member's words: a change or a
 * cancellation of an earlier one, a choice made at the day gate, or leave the Owner set.
 */
export function leaveKind(
  request: Pick<OwnLeaveRequest, "source" | "requestsCancellation" | "original">,
): string | null {
  if (request.requestsCancellation) return "Cancellation of this leave";
  if (request.original) {
    return `Change of ${LEAVE_TYPE_LABELS[request.original.type].toLowerCase()} on ${leaveDates(request.original.startDate, request.original.endDate)}`;
  }
  if (request.source === "attendance") return "Chosen at the start of the day";
  if (request.source === "owner") return "Set by the Owner";
  return null;
}

/**
 * The Owner's reason, shown to the member on their own decisions (owner decision 2026-09-24):
 * a request not approved, and leave the Owner cancelled. A plain approval carries no reason
 * worth repeating, and a replaced row has none of its own.
 */
export function leaveDecisionNote(
  request: Pick<OwnLeaveRequest, "state" | "decisionReason"> & { source?: LeaveSource },
  /** The Owner reading someone else's request (2.4): the same note, turned around. */
  forOwner = false,
): string | null {
  if (!request.decisionReason) return null;
  const prefix = forOwner ? "Your reason" : "The Owner's reason";
  // Leave the Owner set (an edit or a correction, 2.4) carries the Owner's reason for setting
  // it; the edit dialog tells the Owner the person will read it.
  if (request.state === "approved" && request.source === "owner") {
    return `${prefix}: ${request.decisionReason}`;
  }
  // A superseded row keeps the reason of its own approval: the functions that supersede it
  // write none (the Owner's edit reason lives in the audit meta), so repeating it would
  // present an old note as the reason it was replaced.
  if (request.state === "approved" || request.state === "submitted") return null;
  if (request.state === "superseded") return null;
  // `leave_decide` labels an original cancelled at the member's own request this way.
  if (request.decisionReason === CANCELLATION_APPROVED) {
    return forOwner ? "Cancelled at their request." : "Cancelled at your request.";
  }
  return `${prefix}: ${request.decisionReason}`;
}

const CANCELLATION_APPROVED = "cancellation approved";

/**
 * The state word for one row. A cancellation request that the Owner approves ends
 * `cancelled` together with the leave it cancels (WORKFLOWS §2), which for the member means
 * "your cancellation went through", not "your request was cancelled".
 */
export function leaveStateLabel(
  request: Pick<OwnLeaveRequest, "state" | "requestsCancellation">,
): string {
  if (request.requestsCancellation && request.state === "cancelled") return "Leave cancelled";
  return LEAVE_STATE_LABELS[request.state];
}
