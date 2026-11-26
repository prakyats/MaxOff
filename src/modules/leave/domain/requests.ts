import type { Enums } from "@/core/db";
import { formatIST, istDayStart } from "@/core/time";

export type LeaveType = Enums<"leave_type">;
export type LeaveState = Enums<"leave_state">;
/** Which half of a half day is off (v1.9 W4); older half days have none. */
export type LeaveHalf = "morning" | "afternoon";
export const LEAVE_HALVES = ["morning", "afternoon"] as const satisfies readonly LeaveHalf[];
export const HALF_LABELS: Record<LeaveHalf, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
};
/** The other half of the same date: a split day's ordinary half is the comp half's opposite. */
export function otherHalf(half: LeaveHalf): LeaveHalf {
  return half === "morning" ? "afternoon" : "morning";
}
/** A database `half` (text, checked morning | afternoon) as the screens type it. */
export function toHalf(value: string | null | undefined): LeaveHalf | null {
  return value === "morning" || value === "afternoon" ? value : null;
}

/** Where a request came from (DATA-MODEL §3): the form, the day gate, or the Owner's own edit. */
export type LeaveSource = "form" | "attendance" | "owner";

export const LEAVE_TYPES = [
  "leave",
  "half_day",
  "comp_leave",
] as const satisfies readonly LeaveType[];
/** What a member's plain request or change may be (3b.2: comp leave goes through a credit). */
export const MEMBER_LEAVE_TYPES = ["leave", "half_day"] as const satisfies readonly LeaveType[];
export type MemberLeaveType = (typeof MEMBER_LEAVE_TYPES)[number];
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
  /** The comp leave credit it uses (3b.2): 1 for a comp day, 0.5 for a half comp day, else null. */
  creditDays: number | null;
  /** Which half of a half day is off (v1.9 W4); null for a full day and older half days. */
  half: LeaveHalf | null;
  /**
   * v2.0.1: the two halves of one "Full day: ½ comp + ½ leave" share it (`leave_submit_split`, or
   * the Owner's split-day correction). While they wait they are one unit; once approved each half
   * stands on its own.
   */
  pairId: string | null;
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
  request: Pick<OwnLeaveRequest, "state" | "source" | "hasOpenChange" | "endDate"> & {
    creditDays?: number | null;
  },
  today: string,
): LeaveRequestActions {
  const withdraw = request.state === "submitted" && request.source !== "attendance";
  const changeable =
    request.state === "approved" && request.endDate >= today && !request.hasOpenChange;
  // 3b.2: comp leave is tied to the credits it drew for that date: cancel and request again,
  // never move it (`leave_request_change` refuses a change of a request with credit_days).
  return { withdraw, change: changeable && !request.creditDays, cancel: changeable };
}

/** What `leave_request_change` answers for approved leave that has fully passed (2.3). */
export const LEAVE_ENDED_MESSAGE = "This leave has ended. Ask the Owner to correct it.";

/** The same, said once under the laptop's table of requests (PP-crew-9, V5b). */
export const LEAVE_ENDED_HINT =
  "Leave that has ended can't be changed here. Ask the Owner to correct it.";

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

/**
 * "Leave · 3 days", "Half day · morning off", "Half day · comp · afternoon off" (a half comp day,
 * 3b.2; the half since v2.0.1), "Comp leave · 1 day". An older half day with no half recorded is
 * "Half day" or "Half day · comp".
 */
export function leaveTitle(
  request: Pick<OwnLeaveRequest, "type" | "startDate" | "endDate"> & {
    creditDays?: number | null;
    half?: LeaveHalf | null;
  },
): string {
  if (request.type === "half_day") {
    const parts: string[] = [LEAVE_TYPE_LABELS.half_day];
    if (request.creditDays) parts.push("comp");
    if (request.half) parts.push(`${request.half} off`);
    return parts.join(" · ");
  }
  const count = leaveDayCount(request.startDate, request.endDate);
  return `${LEAVE_TYPE_LABELS[request.type]} · ${count} ${count === 1 ? "day" : "days"}`;
}

/**
 * "leave", "comp leave", "half day · comp · morning off": what a request is, inside a sentence
 * ("Now: half day · morning off on …"). Only a half day needs more than its type's word.
 */
export function leaveWhat(
  request: Pick<OwnLeaveRequest, "type" | "startDate" | "endDate"> & {
    creditDays?: number | null;
    half?: LeaveHalf | null;
  },
): string {
  return request.type === "half_day"
    ? leaveTitle(request).toLowerCase()
    : LEAVE_TYPE_LABELS[request.type].toLowerCase();
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
  // W4: on someone else's leave the Owner reads his own words as "You wrote", never "Your
  // reason" (which reads as the person's).
  const prefix = forOwner ? "You wrote" : "The Owner's reason";
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

// v2.0.1 "Flexible comp leave": a split day asked for in one go -----------------------------------

/** The two halves of one split day, morning first, as one card shows them. */
export type LeavePair = { pairId: string; halves: OwnLeaveRequest[] };

/** One card of the requests list: a request, or the two halves of a split day together. */
export type LeaveListEntry =
  | { kind: "single"; id: string; request: OwnLeaveRequest }
  | { kind: "pair"; id: string; pair: LeavePair };

const HALF_ORDER: Record<LeaveHalf, number> = { morning: 0, afternoon: 1 };

/**
 * The list's cards, in the page's order: the two halves of a split day (one `pair_id`) become one
 * card where the first of them stood. A half whose partner is not on this page (the page ends
 * between them) stays a card of its own, so nothing is hidden.
 */
export function groupLeavePairs(requests: readonly OwnLeaveRequest[]): LeaveListEntry[] {
  const byPair = new Map<string, OwnLeaveRequest[]>();
  for (const request of requests) {
    if (!request.pairId) continue;
    byPair.set(request.pairId, [...(byPair.get(request.pairId) ?? []), request]);
  }
  const entries: LeaveListEntry[] = [];
  const placed = new Set<string>();
  for (const request of requests) {
    const halves = request.pairId ? byPair.get(request.pairId) : undefined;
    if (!request.pairId || !halves || halves.length < 2) {
      entries.push({ kind: "single", id: request.id, request });
      continue;
    }
    if (placed.has(request.pairId)) continue;
    placed.add(request.pairId);
    const sorted = [...halves].sort(
      (a, b) => HALF_ORDER[a.half ?? "morning"] - HALF_ORDER[b.half ?? "morning"],
    );
    entries.push({
      kind: "pair",
      id: request.pairId,
      pair: { pairId: request.pairId, halves: sorted },
    });
  }
  return entries;
}

/** "Full day · ½ comp + ½ leave": a split day's card (WORKFLOWS §2 "Settled in v2.0.1"). */
export const PAIR_TITLE = "Full day · ½ comp + ½ leave";

/** "Morning · ½ comp", "Afternoon · ½ leave": one half's line on the card. */
export function pairHalfLine(request: Pick<OwnLeaveRequest, "half" | "creditDays">): string {
  const half = request.half ? HALF_LABELS[request.half] : LEAVE_TYPE_LABELS.half_day;
  return `${half} · ${request.creditDays ? "½ comp" : "½ leave"}`;
}

/**
 * The pair's one state for the card's glance: the halves' own while they agree (they always do
 * while waiting, and once decided together), "One half approved" once one half was cancelled or
 * changed on its own and the other still stands.
 */
export function pairState(pair: LeavePair): { status: LeaveState; label: string } {
  const [first] = pair.halves;
  const state = first?.state ?? "submitted";
  if (pair.halves.every((half) => half.state === state)) {
    return { status: state, label: LEAVE_STATE_LABELS[state] };
  }
  if (pair.halves.some((half) => half.state === "approved")) {
    return { status: "approved", label: "One half approved" };
  }
  return { status: state, label: LEAVE_STATE_LABELS[state] };
}

/**
 * What the member may do with a split day (mirrors `leave_withdraw` / `leave_request_change`):
 * **Withdraw** while it waits, one call for both halves (any waiting half's id: the function
 * withdraws its partner); once approved, each half on its own, as `leaveRequestActions()` says
 * for that half (ask to cancel either; change only the ordinary half, a comp half is cancelled
 * and asked for again).
 */
export function leavePairActions(
  pair: LeavePair,
  today: string,
): {
  withdrawId: string | null;
  halves: { request: OwnLeaveRequest; actions: LeaveRequestActions }[];
} {
  const waiting = pair.halves.find((half) => leaveRequestActions(half, today).withdraw);
  return {
    withdrawId: waiting?.id ?? null,
    halves: pair.halves.map((request) => ({
      request,
      actions: { ...leaveRequestActions(request, today), withdraw: false },
    })),
  };
}
