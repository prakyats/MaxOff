import { formatIST, istDayStart } from "@/core/time";

import {
  LEAVE_TYPE_LABELS,
  leaveDates,
  type LeaveSource,
  type LeaveState,
  leaveTitle,
  type LeaveType,
  type OwnLeaveRequest,
} from "./requests";

/**
 * The Owner's side of leave (task 2.4, WORKFLOWS §2 "Settled in 2.4"): the Leave group of
 * Approvals and what the Owner may do with a person's approved leave.
 */

/** A request waiting for the Owner. Never a gate request: those are decided with their day. */
export type PendingLeave = {
  id: string;
  memberId: string;
  memberName: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
  source: LeaveSource;
  requestsCancellation: boolean;
  createdAt: string;
  /** The approved leave this one changes or cancels, as it stands now. */
  original: { type: LeaveType; startDate: string; endDate: string; state: LeaveState } | null;
};

/** "Leave · 3 days", "Cancel leave · 2 days", "Change to half day". */
export function pendingLeaveTitle(request: PendingLeave): string {
  if (request.requestsCancellation) return `Cancel ${leaveTitle(request).toLowerCase()}`;
  if (request.original) return `Change to ${leaveTitle(request).toLowerCase()}`;
  return leaveTitle(request);
}

/** "Asha · 12 – 14 Oct 2026". */
export function pendingLeaveSubtitle(request: PendingLeave): string {
  return `${request.memberName} · ${leaveDates(request.startDate, request.endDate)}`;
}

/** The dot's word: what kind of decision this is. */
export function pendingLeaveStatus(request: PendingLeave): string {
  if (request.requestsCancellation) return "Cancellation";
  if (request.original) return "Change";
  return "Waiting";
}

/** "Approved Asha's leave", for the Undo toast. */
export function approvedLeaveLabel(request: PendingLeave, firstName: string): string {
  if (request.requestsCancellation) return `Cancelled ${firstName}'s leave`;
  return `Approved ${firstName}'s ${LEAVE_TYPE_LABELS[request.type].toLowerCase()}`;
}

/**
 * A change whose original is no longer approved (the Owner cancelled it meanwhile) is approved
 * as a fresh request (WORKFLOWS §2, 2.1 follow-up c): the sheet says so before the Owner acts.
 */
export function changeOfGoneLeave(request: PendingLeave): boolean {
  return (
    request.original !== null &&
    !request.requestsCancellation &&
    request.original.state !== "approved"
  );
}

/** Oldest first inside the group (PRODUCT "Approvals"). */
export function sortPendingLeave<T extends Pick<PendingLeave, "createdAt" | "id">>(
  requests: readonly T[],
): T[] {
  return [...requests].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export type OwnerLeaveActions = { edit: boolean; cancel: boolean };

/**
 * What the Owner may do with one of a person's requests, mirroring `leave_owner_edit` and
 * `leave_owner_cancel`: both need approved leave (any dates, past included), and an edit waits
 * while the person has a change or cancellation of it open (CONFLICT: decide that first).
 */
export function ownerLeaveActions(
  request: Pick<OwnLeaveRequest, "state" | "hasOpenChange">,
): OwnerLeaveActions {
  const approved = request.state === "approved";
  return { edit: approved && !request.hasOpenChange, cancel: approved };
}

/**
 * "These days keep your earlier decision: Wed, 23 Sep and Thu, 24 Sep." after an approval or an
 * edit that covered days the Owner had already decided (WORKFLOWS §1 "Settled in 2.2").
 */
export function keptDatesNote(dates: readonly string[]): string | null {
  if (dates.length === 0) return null;
  const labels = [...dates].sort().map((date) => formatIST(istDayStart(date), "EEE, d MMM"));
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${dates.length === 1 ? "This day keeps" : "These days keep"} your earlier decision: ${list}.`;
}

/** "Asha" from "Asha Rao": what the Owner's screens call a person in a sentence. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
