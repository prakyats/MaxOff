import { describe, expect, it } from "vitest";

import {
  groupLeavePairs,
  leavePairActions,
  leaveTitle,
  leaveWhat,
  type OwnLeaveRequest,
  PAIR_TITLE,
  pairHalfLine,
  pairState,
} from "../domain/requests";
import {
  approvedLeaveLabel,
  mergePendingPairs,
  ownerHalfCompOption,
  type PendingLeave,
  pendingLeaveDetail,
  pendingLeaveSubtitle,
  pendingLeaveTitle,
  pendingPairHalves,
} from "../domain/review";
import { changeLeaveSchema, ownerEditLeaveSchema } from "../domain/schemas";

/**
 * v2.0.1 "Flexible comp leave" (WORKFLOWS §2 "Settled in v2.0.1"): halves name themselves, a split
 * day ("Full day: ½ comp + ½ leave", two half days sharing a `pair_id`) is one card and one
 * Approvals row, and its actions mirror `leave_withdraw` / `leave_decide` / `leave_request_change`.
 */

const TODAY = "2026-11-25";
const PAIR = "00000000-0000-4000-8000-0000000000ff";

const REQUEST: OwnLeaveRequest = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "leave",
  startDate: "2026-11-27",
  endDate: "2026-11-27",
  reason: null,
  state: "submitted",
  source: "form",
  supersedesId: null,
  requestsCancellation: false,
  decisionReason: null,
  createdAt: "2026-11-25T04:00:00Z",
  original: null,
  hasOpenChange: false,
  creditDays: null,
  half: null,
  pairId: null,
};
const request = (patch: Partial<OwnLeaveRequest>): OwnLeaveRequest => ({ ...REQUEST, ...patch });

/** The two halves `leave_submit_split` makes, newest first as the list reads them. */
const compMorning = request({
  id: "00000000-0000-4000-8000-00000000000a",
  type: "half_day",
  creditDays: 0.5,
  half: "morning",
  pairId: PAIR,
});
const leaveAfternoon = request({
  id: "00000000-0000-4000-8000-00000000000b",
  type: "half_day",
  half: "afternoon",
  pairId: PAIR,
});

describe("half day titles say the half", () => {
  it("names the half off, and comp for a ½ comp day", () => {
    expect(leaveTitle(request({ type: "half_day", half: "morning" }))).toBe(
      "Half day · morning off",
    );
    expect(leaveTitle(request({ type: "half_day", half: "afternoon", creditDays: 0.5 }))).toBe(
      "Half day · comp · afternoon off",
    );
    // Older half days with no half keep their titles; full days are unchanged.
    expect(leaveTitle(request({ type: "half_day" }))).toBe("Half day");
    expect(leaveTitle(request({ type: "half_day", creditDays: 0.5 }))).toBe("Half day · comp");
    expect(leaveTitle(request({}))).toBe("Leave · 1 day");
  });

  it("says what a request is inside a sentence", () => {
    expect(leaveWhat(request({ type: "half_day", half: "morning", creditDays: 0.5 }))).toBe(
      "half day · comp · morning off",
    );
    expect(leaveWhat(request({ type: "comp_leave", creditDays: 1 }))).toBe("comp leave");
    expect(leaveWhat(request({ endDate: "2026-11-30" }))).toBe("leave");
  });
});

describe("groupLeavePairs: a split day is one card", () => {
  it("puts both halves on one card, morning first, where the first of them stood", () => {
    const before = request({ id: "00000000-0000-4000-8000-000000000002" });
    const after = request({ id: "00000000-0000-4000-8000-000000000003" });
    const entries = groupLeavePairs([before, leaveAfternoon, compMorning, after]);
    expect(entries.map((entry) => entry.id)).toEqual([before.id, PAIR, after.id]);
    const pair = entries[1];
    expect(pair?.kind).toBe("pair");
    if (pair?.kind !== "pair") return;
    expect(pair.pair.halves.map((half) => half.half)).toEqual(["morning", "afternoon"]);
  });

  it("keeps a half whose partner is on another page as a card of its own", () => {
    const entries = groupLeavePairs([request({}), compMorning]);
    expect(entries.map((entry) => entry.kind)).toEqual(["single", "single"]);
  });

  it("writes the card and each half's line", () => {
    expect(PAIR_TITLE).toBe("Full day · ½ comp + ½ leave");
    expect(pairHalfLine(compMorning)).toBe("Morning · ½ comp");
    expect(pairHalfLine(leaveAfternoon)).toBe("Afternoon · ½ leave");
  });
});

describe("a split day's state and actions", () => {
  const pair = (morning: Partial<OwnLeaveRequest>, afternoon: Partial<OwnLeaveRequest>) => ({
    pairId: PAIR,
    halves: [
      { ...compMorning, ...morning },
      { ...leaveAfternoon, ...afternoon },
    ],
  });

  it("reads as one state while the halves agree, and says when one half stands alone", () => {
    expect(pairState(pair({}, {}))).toEqual({ status: "submitted", label: "Waiting" });
    expect(pairState(pair({ state: "approved" }, { state: "approved" }))).toEqual({
      status: "approved",
      label: "Approved",
    });
    expect(pairState(pair({ state: "cancelled" }, { state: "approved" }))).toEqual({
      status: "approved",
      label: "One half approved",
    });
    expect(pairState(pair({ state: "rejected" }, { state: "rejected" })).label).toBe(
      "Not approved",
    );
  });

  it("withdraws both halves with one call while waiting (leave_withdraw takes the partner)", () => {
    const actions = leavePairActions(pair({}, {}), TODAY);
    expect(actions.withdrawId).toBe(compMorning.id);
    // No half has its own Withdraw: there is one, for the day.
    expect(actions.halves.every((half) => !half.actions.withdraw)).toBe(true);
    expect(actions.halves.every((half) => !half.actions.cancel && !half.actions.change)).toBe(true);
  });

  it("gives each approved half its own actions: change only the ordinary half", () => {
    const actions = leavePairActions(pair({ state: "approved" }, { state: "approved" }), TODAY);
    expect(actions.withdrawId).toBeNull();
    expect(actions.halves.map((half) => half.actions)).toEqual([
      // The comp half is cancelled and asked for again, never moved.
      { withdraw: false, change: false, cancel: true },
      { withdraw: false, change: true, cancel: true },
    ]);
  });

  it("holds a half with a change already waiting, and offers nothing once the day has passed", () => {
    const open = leavePairActions(
      pair({ state: "approved" }, { state: "approved", hasOpenChange: true }),
      TODAY,
    );
    expect(open.halves[1]?.actions).toEqual({ withdraw: false, change: false, cancel: false });
    const ended = leavePairActions(
      pair({ state: "approved" }, { state: "approved" }),
      "2026-11-28",
    );
    expect(ended.halves.every((half) => !half.actions.cancel)).toBe(true);
  });
});

describe("the half in a change and in the Owner's edit", () => {
  it("sends the chosen half of a half-day change", () => {
    const schema = changeLeaveSchema(TODAY, "2026-11-27");
    expect(
      schema.parse({ type: "half_day", startDate: "2026-11-27", half: "afternoon" }),
    ).toMatchObject({ type: "half_day", half: "afternoon", endDate: "2026-11-27" });
  });

  it("takes the half and ½ comp only for a half day, null keeping the original's", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      ownerEditLeaveSchema.parse({
        requestId: id,
        type: "half_day",
        startDate: "2026-11-27",
        half: "morning",
        comp: true,
      }),
    ).toMatchObject({ half: "morning", comp: true, endDate: "2026-11-27" });
    expect(
      ownerEditLeaveSchema.parse({ requestId: id, type: "half_day", startDate: "2026-11-27" }),
    ).toMatchObject({ half: null, comp: null });
    // A full day sends neither, whatever the form held.
    expect(
      ownerEditLeaveSchema.parse({
        requestId: id,
        type: "leave",
        startDate: "2026-11-27",
        endDate: "2026-11-28",
        half: "morning",
        comp: true,
      }),
    ).toMatchObject({ half: null, comp: null });
    // A ½ comp day needs its half.
    const noHalf = ownerEditLeaveSchema.safeParse({
      requestId: id,
      type: "half_day",
      startDate: "2026-11-27",
      comp: true,
    });
    expect(noHalf.error?.issues.map((issue) => issue.path.join("."))).toEqual(["half"]);
  });

  it("offers Use ½ comp leave on the edit with a credit, or when the day already used one", () => {
    expect(ownerHalfCompOption(0, { creditDays: null }, "Asha", false)).toEqual({
      disabled: true,
      hint: "Asha has no comp leave credit: grant one first.",
    });
    expect(ownerHalfCompOption(0, { creditDays: 0.5 }, "Asha", true)).toEqual({
      disabled: false,
      hint: "Asha's comp credit stays with the day.",
    });
    expect(ownerHalfCompOption(1, { creditDays: null }, "Asha", true)).toEqual({
      disabled: false,
      hint: "Uses ½ day of Asha's comp leave.",
    });
    expect(ownerHalfCompOption(undefined, { creditDays: null }, "Asha", false)).toEqual({
      disabled: false,
      hint: null,
    });
  });
});

describe("Approvals: a waiting split day is one row", () => {
  const PENDING: PendingLeave = {
    id: "00000000-0000-4000-8000-000000000001",
    memberId: "m",
    memberName: "Asha Rao",
    type: "leave",
    startDate: "2026-11-27",
    endDate: "2026-11-27",
    reason: null,
    source: "form",
    requestsCancellation: false,
    createdAt: "2026-11-25T04:00:00Z",
    creditDays: null,
    original: null,
    half: null,
    pairId: null,
  };
  const pending = (patch: Partial<PendingLeave>): PendingLeave => ({ ...PENDING, ...patch });
  const comp = pending({
    id: compMorning.id,
    type: "half_day",
    creditDays: 0.5,
    half: "morning",
    pairId: PAIR,
  });
  const other = pending({
    id: leaveAfternoon.id,
    type: "half_day",
    half: "afternoon",
    pairId: PAIR,
  });

  it("merges the two halves into the comp half's row, whichever comes first", () => {
    for (const rows of [
      [other, comp],
      [comp, other],
    ]) {
      const merged = mergePendingPairs([pending({}), ...rows]);
      expect(merged.map((row) => row.id)).toEqual([PENDING.id, comp.id]);
      expect(merged[1]?.pair).toEqual({ compHalf: "morning", partnerId: other.id });
    }
  });

  it("keeps a half whose partner is no longer waiting (a holiday cancelled the comp half)", () => {
    expect(mergePendingPairs([other])).toEqual([other]);
  });

  it("titles the row as the day, and the Undo toast as a full day", () => {
    const [row] = mergePendingPairs([comp, other]);
    if (!row) throw new Error("no row");
    expect(pendingLeaveTitle(row)).toBe("Full day · ½ comp (morning) + ½ leave");
    expect(pendingLeaveSubtitle(row)).toBe("Asha Rao · Fri, 27 Nov 2026");
    expect(pendingLeaveDetail(row)).toBe("Full day · ½ comp (morning) + ½ leave · Fri 27 Nov");
    expect(approvedLeaveLabel(row, "Asha")).toBe("Approved Asha's full day");
    expect(pendingPairHalves("morning")).toBe(
      "Morning is comp leave (½ credit), the afternoon ordinary leave",
    );
  });

  it("titles a single half by its half; the subtitle no longer repeats it", () => {
    const half = pending({ type: "half_day", half: "afternoon" });
    expect(pendingLeaveTitle(half)).toBe("Half day · afternoon off");
    expect(pendingLeaveSubtitle(half)).toBe("Asha Rao · Fri, 27 Nov 2026");
  });
});
