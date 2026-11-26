import { formatIST, istDayStart } from "@/core/time";

import { daysLabel } from "./credits";
import {
  HALF_LABELS,
  LEAVE_TYPE_LABELS,
  leaveDates,
  type LeaveHalf,
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
  /** Their photo (`members.avatar_file_id`), read with the name (V5b-D). */
  memberAvatarFileId?: string | null;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
  source: LeaveSource;
  requestsCancellation: boolean;
  createdAt: string;
  /** The comp leave credit it uses (3b.2), so the Owner sees "Half day · comp". */
  creditDays: number | null;
  /** The approved leave this one changes or cancels, as it stands now. */
  original: { type: LeaveType; startDate: string; endDate: string; state: LeaveState } | null;
  /** v1.9 W4: which half of a half day (older requests: none). */
  half?: LeaveHalf | null;
  /** v2.0.1: the split day this half belongs to (`leave_requests.pair_id`). */
  pairId?: string | null;
  /**
   * v2.0.1: set when this row stands for a whole waiting split day ("Full day: ½ comp + ½ leave",
   * `mergePendingPairs`): the half that is comp, and the other half's request. Approve or Reject
   * on this row's id decides both (`leave_decide` does it), so the other half is never sent.
   */
  pair?: { compHalf: LeaveHalf; partnerId: string } | null;
};

/**
 * v2.0.1: a waiting split day is **one** row (WORKFLOWS §2: the Owner decides it as one): the two
 * halves sharing a `pair_id` become the comp half's row, marked with `pair`, in the comp half's
 * place. A half whose partner is not waiting (a holiday cancelled the comp half) stays a row of
 * its own, so nothing waiting is hidden.
 */
export function mergePendingPairs(requests: readonly PendingLeave[]): PendingLeave[] {
  const byPair = new Map<string, PendingLeave[]>();
  for (const request of requests) {
    if (request.pairId)
      byPair.set(request.pairId, [...(byPair.get(request.pairId) ?? []), request]);
  }
  return requests.flatMap((request): PendingLeave[] => {
    const halves = request.pairId ? (byPair.get(request.pairId) ?? []) : [];
    if (halves.length !== 2) return [request];
    const lead = halves.find((half) => half.creditDays) ?? halves[0];
    const partner = halves.find((half) => half !== lead);
    if (request !== lead || !lead?.half || !partner) return [];
    return [{ ...request, pair: { compHalf: lead.half, partnerId: partner.id } }];
  });
}

/** "Full day · ½ comp (morning) + ½ leave": a waiting split day's one row. */
export function pendingPairTitle(compHalf: LeaveHalf): string {
  return `Full day · ½ comp (${compHalf}) + ½ leave`;
}

/** "Leave · 3 days", "Cancel leave · 2 days", "Change to half day · morning off". */
export function pendingLeaveTitle(request: PendingLeave): string {
  if (request.pair) return pendingPairTitle(request.pair.compHalf);
  if (request.requestsCancellation) return `Cancel ${leaveTitle(request).toLowerCase()}`;
  if (request.original) return `Change to ${leaveTitle(request).toLowerCase()}`;
  return leaveTitle(request);
}

/** "Asha · 12 – 14 Oct 2026" (the title says which half, v2.0.1). */
export function pendingLeaveSubtitle(request: PendingLeave): string {
  return `${request.memberName} · ${leaveDates(request.startDate, request.endDate)}`;
}

/** "Comp in the morning, leave in the afternoon": a split day's fact in the Review sheet. */
export function pendingPairHalves(compHalf: LeaveHalf): string {
  const other = compHalf === "morning" ? "afternoon" : "morning";
  return `${HALF_LABELS[compHalf]} is comp leave (½ credit), the ${other} ordinary leave`;
}

/** v1.9 W4: a half day's half, as the Owner reads it. */
const HALF_WORDS = { morning: "morning off", afternoon: "afternoon off" } as const;

/**
 * The Owner's Today compact row's first meta line, what and when (owner 2026-10-09): "Leave · Mon
 * 19 – Tue 20 Oct", "Half day · Fri 23 Oct", "Cancel leave · Mon 12 Oct", "Change to half day ·
 * Mon 12 Oct". The dates say how many days, so no count; short enough never to be cut short.
 */
export function pendingLeaveDetail(request: PendingLeave): string {
  if (request.pair) {
    return `${pendingPairTitle(request.pair.compHalf)} · ${shortDates(request.startDate, request.endDate)}`;
  }
  const kind =
    request.type === "half_day" && request.creditDays
      ? `${LEAVE_TYPE_LABELS.half_day} · comp`
      : LEAVE_TYPE_LABELS[request.type];
  const what = request.requestsCancellation
    ? `Cancel ${kind.toLowerCase()}`
    : request.original
      ? `Change to ${kind.toLowerCase()}`
      : kind;
  const half = request.half ? ` (${HALF_WORDS[request.half]})` : "";
  return `${what}${half} · ${shortDates(request.startDate, request.endDate)}`;
}

/** "Mon 12 Oct", "Mon 12 – Wed 14 Oct", or "Fri 30 Oct – Mon 2 Nov" across a month. */
export function shortDates(startDate: string, endDate: string): string {
  const start = istDayStart(startDate);
  if (startDate === endDate) return formatIST(start, "EEE d MMM");
  const end = formatIST(istDayStart(endDate), "EEE d MMM");
  const sameMonth = startDate.slice(0, 7) === endDate.slice(0, 7);
  return `${formatIST(start, sameMonth ? "EEE d" : "EEE d MMM")} – ${end}`;
}

/** The dot's word: what kind of decision this is. */
export function pendingLeaveStatus(request: PendingLeave): string {
  if (request.requestsCancellation) return "Cancellation";
  if (request.original) return "Change";
  return "Waiting";
}

/** "Approved Asha's leave", for the Undo toast. */
export function approvedLeaveLabel(request: PendingLeave, name: string): string {
  if (request.pair) return `Approved ${name}'s full day`;
  if (request.requestsCancellation) return `Cancelled ${name}'s leave`;
  return `Approved ${name}'s ${LEAVE_TYPE_LABELS[request.type].toLowerCase()}`;
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

/**
 * Whether the Owner's edit dialog offers comp leave (3c review): `leave_owner_edit` into comp
 * leave draws one of the person's credits (kickoff 3b decision 16), so with none the option is
 * greyed out and the hint says what to do; the request's own credit goes back first, so a request
 * that already is comp leave can always be moved. `compDays` is the person's balance today, or
 * undefined where the screen does not know it.
 */
export function ownerCompLeaveOption(
  compDays: number | undefined,
  request: Pick<OwnLeaveRequest, "type">,
  name: string,
): { disabled: boolean; hint: string | null } {
  if (request.type === "comp_leave") {
    return { disabled: false, hint: `${name}'s credit moves with the day.` };
  }
  if (compDays === undefined) return { disabled: false, hint: null };
  if (compDays <= 0) {
    return { disabled: true, hint: `${name} has no comp leave credit: grant one first.` };
  }
  return { disabled: false, hint: `${name} has ${daysLabel(compDays)} of comp leave.` };
}

/**
 * v2.0.1: whether the Owner's edit offers **Use ½ comp leave** on a half day
 * (`leave_owner_edit(…, comp)`): it draws ½ of the person's credit, after the request's own credit
 * goes back, so a request that already used a credit (a ½ comp day, or a comp day made a half day)
 * can always keep it; otherwise it needs ½ day free. `compDays` is the person's balance today, or
 * undefined where the screen does not know it (the database's refusal then shows in the alert).
 */
export function ownerHalfCompOption(
  compDays: number | undefined,
  request: Pick<OwnLeaveRequest, "creditDays">,
  name: string,
  checked: boolean,
): { disabled: boolean; hint: string | null } {
  if (request.creditDays) {
    return { disabled: false, hint: checked ? `${name}'s comp credit stays with the day.` : null };
  }
  if (compDays !== undefined && compDays < 0.5) {
    return { disabled: true, hint: `${name} has no comp leave credit: grant one first.` };
  }
  return { disabled: false, hint: checked ? `Uses ½ day of ${name}'s comp leave.` : null };
}
