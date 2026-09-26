import { describe, expect, it } from "vitest";

import { leaveDecisionNote } from "../domain/requests";
import {
  approvedLeaveLabel,
  changeOfGoneLeave,
  keptDatesNote,
  ownerLeaveActions,
  type PendingLeave,
  pendingLeaveStatus,
  pendingLeaveTitle,
  sortPendingLeave,
} from "../domain/review";
import { ownerEditLeaveSchema, rejectLeaveSchema } from "../domain/schemas";

const REQUEST: PendingLeave = {
  id: "r",
  memberId: "m",
  memberName: "Asha Rao",
  type: "leave",
  startDate: "2026-10-12",
  endDate: "2026-10-14",
  reason: null,
  source: "form",
  requestsCancellation: false,
  createdAt: "2026-09-24T03:40:00Z",
  original: null,
};
const request = (patch: Partial<PendingLeave>): PendingLeave => ({ ...REQUEST, ...patch });

describe("ownerLeaveActions mirrors leave_owner_edit / leave_owner_cancel", () => {
  it("offers both on approved leave, past or future", () => {
    expect(ownerLeaveActions({ state: "approved", hasOpenChange: false })).toEqual({
      edit: true,
      cancel: true,
    });
  });
  it("holds the edit while the person has a change open (CONFLICT: decide that first)", () => {
    expect(ownerLeaveActions({ state: "approved", hasOpenChange: true })).toEqual({
      edit: false,
      cancel: true,
    });
  });
  it("offers nothing on any other state", () => {
    for (const state of [
      "submitted",
      "rejected",
      "withdrawn",
      "superseded",
      "cancelled",
    ] as const) {
      expect(ownerLeaveActions({ state, hasOpenChange: false })).toEqual({
        edit: false,
        cancel: false,
      });
    }
  });
});

describe("the Leave group's rows", () => {
  it("says what kind of decision it is", () => {
    expect(pendingLeaveTitle(request({}))).toBe("Leave · 3 days");
    expect(pendingLeaveStatus(request({}))).toBe("Waiting");
    const original = {
      type: "leave" as const,
      startDate: "2026-10-12",
      endDate: "2026-10-14",
      state: "approved" as const,
    };
    expect(pendingLeaveTitle(request({ original, requestsCancellation: true }))).toBe(
      "Cancel leave · 3 days",
    );
    expect(pendingLeaveStatus(request({ original, requestsCancellation: true }))).toBe(
      "Cancellation",
    );
    expect(
      pendingLeaveTitle(
        request({ original, type: "half_day", startDate: "2026-10-12", endDate: "2026-10-12" }),
      ),
    ).toBe("Change to half day");
    expect(approvedLeaveLabel(request({}), "Asha")).toBe("Approved Asha's leave");
    expect(approvedLeaveLabel(request({ original, requestsCancellation: true }), "Asha")).toBe(
      "Cancelled Asha's leave",
    );
  });

  it("warns when a change's original is gone (2.1 follow-up c)", () => {
    const gone = {
      type: "leave" as const,
      startDate: "2026-10-12",
      endDate: "2026-10-14",
      state: "cancelled" as const,
    };
    expect(changeOfGoneLeave(request({ original: gone }))).toBe(true);
    expect(changeOfGoneLeave(request({ original: { ...gone, state: "approved" } }))).toBe(false);
    expect(changeOfGoneLeave(request({ original: gone, requestsCancellation: true }))).toBe(false);
    expect(changeOfGoneLeave(request({}))).toBe(false);
  });

  it("orders oldest first", () => {
    const sorted = sortPendingLeave([
      request({ id: "b", createdAt: "2026-09-24T05:00:00Z" }),
      request({ id: "a", createdAt: "2026-09-23T05:00:00Z" }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("keptDatesNote", () => {
  it("names the days that keep an earlier decision, and nothing when there are none", () => {
    expect(keptDatesNote([])).toBeNull();
    expect(keptDatesNote(["2026-09-23"])).toBe(
      "This day keeps your earlier decision: Wed, 23 Sep.",
    );
    expect(keptDatesNote(["2026-09-24", "2026-09-22", "2026-09-23"])).toBe(
      "These days keep your earlier decision: Tue, 22 Sep, Wed, 23 Sep and Thu, 24 Sep.",
    );
  });
});

describe("leaveDecisionNote for the Owner and for Owner-set leave (2.4)", () => {
  it("turns the note around for the Owner", () => {
    expect(leaveDecisionNote({ state: "rejected", decisionReason: "Shoot that week" }, true)).toBe(
      "Your reason: Shoot that week",
    );
    expect(
      leaveDecisionNote({ state: "cancelled", decisionReason: "cancellation approved" }, true),
    ).toBe("Cancelled at their request.");
  });
  it("shows the Owner's reason on leave the Owner set, to both", () => {
    const set = {
      state: "approved" as const,
      decisionReason: "Moved to match the shoot",
      source: "owner" as const,
    };
    expect(leaveDecisionNote(set)).toBe("The Owner's reason: Moved to match the shoot");
    expect(leaveDecisionNote(set, true)).toBe("Your reason: Moved to match the shoot");
    expect(leaveDecisionNote({ ...set, source: "form" })).toBeNull();
  });
});

describe("the Owner's forms", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("a rejection needs a reason", () => {
    expect(rejectLeaveSchema.safeParse({ requestId: id, reason: "  " }).success).toBe(false);
    expect(rejectLeaveSchema.parse({ requestId: id, reason: " Busy week " }).reason).toBe(
      "Busy week",
    );
  });
  it("an edit takes any dates, past included, and a half day is one date", () => {
    expect(
      ownerEditLeaveSchema.parse({
        requestId: id,
        type: "leave",
        startDate: "2020-01-01",
        endDate: "2020-01-03",
      }),
    ).toMatchObject({ startDate: "2020-01-01", endDate: "2020-01-03", reason: null });
    expect(
      ownerEditLeaveSchema.parse({
        requestId: id,
        type: "half_day",
        startDate: "2026-10-01",
        endDate: "2026-10-09",
      }).endDate,
    ).toBe("2026-10-01");
    const backwards = ownerEditLeaveSchema.safeParse({
      requestId: id,
      type: "leave",
      startDate: "2026-10-09",
      endDate: "2026-10-01",
    });
    expect(backwards.success).toBe(false);
    expect(backwards.error?.issues[0]?.path).toEqual(["endDate"]);
  });
});
