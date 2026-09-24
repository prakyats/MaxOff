import { describe, expect, it } from "vitest";

import {
  LEAVE_SOURCES,
  LEAVE_STATES,
  leaveDates,
  leaveDayCount,
  leaveDecisionNote,
  leaveHasEnded,
  leaveKind,
  leaveRequestActions,
  type LeaveSource,
  type LeaveState,
  leaveStateLabel,
  leaveTitle,
  type OwnLeaveRequest,
} from "../domain/requests";
import { cancelLeaveSchema, changeLeaveSchema, requestLeaveSchema } from "../domain/schemas";

const BASE: OwnLeaveRequest = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "leave",
  startDate: "2026-10-12",
  endDate: "2026-10-14",
  reason: null,
  state: "submitted",
  source: "form",
  supersedesId: null,
  requestsCancellation: false,
  decisionReason: null,
  createdAt: "2026-09-24T04:00:00Z",
  original: null,
  hasOpenChange: false,
};
const request = (patch: Partial<OwnLeaveRequest>): OwnLeaveRequest => ({ ...BASE, ...patch });

/**
 * What the transition functions accept from the member, written out independently of the
 * domain function it checks (migrations 20260923160918_attendance_leave.sql and
 * 20260924124326_leave_change_ended.sql):
 * - `leave_withdraw`: `source = attendance` → INVALID_STATE; `state <> submitted` → INVALID_STATE.
 * - `leave_request_change` (change and cancel alike): `state <> approved` → INVALID_STATE;
 *   `end_date < today` → INVALID_STATE ("This leave has ended"); a `submitted` row that
 *   supersedes it → CONFLICT. No rule on the source.
 */
type Timing = "future" | "ongoing" | "ends_today" | "ended";
const TODAY = "2026-09-24";
const DATES: Record<Timing, { startDate: string; endDate: string }> = {
  future: { startDate: "2026-10-12", endDate: "2026-10-14" },
  ongoing: { startDate: "2026-09-22", endDate: "2026-09-26" },
  ends_today: { startDate: "2026-09-23", endDate: TODAY },
  ended: { startDate: "2026-09-20", endDate: "2026-09-23" },
};

function sqlAllows(state: LeaveState, source: LeaveSource, openChange: boolean, timing: Timing) {
  const withdraw = !(source === "attendance") && state === "submitted";
  const change = state === "approved" && timing !== "ended" && !openChange;
  return { withdraw, change, cancel: change };
}

describe("leaveRequestActions mirrors the SQL", () => {
  const timings = Object.keys(DATES) as Timing[];
  const combos = LEAVE_STATES.flatMap((state) =>
    LEAVE_SOURCES.flatMap((source) =>
      [false, true].flatMap((openChange) =>
        timings.map((timing) => ({ state, source, openChange, timing })),
      ),
    ),
  );

  it("covers every state × source × open change × timing combination", () => {
    expect(combos).toHaveLength(6 * 3 * 2 * 4);
  });

  it.each(combos)(
    "$state from $source, open change $openChange, $timing",
    ({ state, source, openChange, timing }) => {
      expect(
        leaveRequestActions({ state, source, hasOpenChange: openChange, ...DATES[timing] }, TODAY),
      ).toEqual(sqlAllows(state, source, openChange, timing));
    },
  );

  it("never offers withdrawing a gate request: the attendance day is its door", () => {
    expect(
      leaveRequestActions(
        { state: "submitted", source: "attendance", hasOpenChange: false, ...DATES.future },
        TODAY,
      ),
    ).toEqual({ withdraw: false, change: false, cancel: false });
  });

  it("offers change and cancel on an approved gate leave, as the database allows", () => {
    expect(
      leaveRequestActions(
        { state: "approved", source: "attendance", hasOpenChange: false, ...DATES.future },
        TODAY,
      ),
    ).toEqual({ withdraw: false, change: true, cancel: true });
  });

  it("keeps ongoing leave changeable and closes leave that has ended", () => {
    const approved = { state: "approved" as const, source: "form" as const, hasOpenChange: false };
    expect(leaveRequestActions({ ...approved, ...DATES.ongoing }, TODAY).change).toBe(true);
    expect(leaveRequestActions({ ...approved, ...DATES.ends_today }, TODAY).cancel).toBe(true);
    expect(leaveRequestActions({ ...approved, ...DATES.ended }, TODAY)).toEqual({
      withdraw: false,
      change: false,
      cancel: false,
    });
    expect(leaveHasEnded({ state: "approved", ...DATES.ended }, TODAY)).toBe(true);
    expect(leaveHasEnded({ state: "approved", ...DATES.ends_today }, TODAY)).toBe(false);
    expect(leaveHasEnded({ state: "rejected", ...DATES.ended }, TODAY)).toBe(false);
  });

  it("offers withdrawing a change or cancellation that is still waiting", () => {
    expect(
      leaveRequestActions(
        { state: "submitted", source: "form", hasOpenChange: false, ...DATES.future },
        TODAY,
      ).withdraw,
    ).toBe(true);
  });
});

describe("request wording", () => {
  it("counts both ends of a range", () => {
    expect(leaveDayCount("2026-10-12", "2026-10-14")).toBe(3);
    expect(leaveDayCount("2026-10-12", "2026-10-12")).toBe(1);
    expect(leaveDayCount("2026-12-31", "2027-01-01")).toBe(2);
  });

  it("titles by kind and length", () => {
    expect(leaveTitle(BASE)).toBe("Leave · 3 days");
    expect(leaveTitle(request({ type: "comp_leave", endDate: "2026-10-12" }))).toBe(
      "Comp leave · 1 day",
    );
    expect(leaveTitle(request({ type: "half_day", endDate: "2026-10-12" }))).toBe("Half day");
  });

  it("writes one date for a day and both ends for a range", () => {
    expect(leaveDates("2026-10-12", "2026-10-12")).toBe("Mon, 12 Oct 2026");
    expect(leaveDates("2026-10-12", "2026-10-14")).toBe("12 Oct – 14 Oct 2026");
    expect(leaveDates("2026-12-31", "2027-01-02")).toBe("31 Dec 2026 – 2 Jan 2027");
  });

  it("says what kind of request a row is", () => {
    expect(leaveKind(BASE)).toBeNull();
    expect(leaveKind(request({ source: "attendance" }))).toBe("Chosen at the start of the day");
    expect(leaveKind(request({ source: "owner" }))).toBe("Set by the Owner");
    expect(leaveKind(request({ requestsCancellation: true }))).toBe("Cancellation of this leave");
    expect(
      leaveKind(
        request({ original: { type: "half_day", startDate: "2026-10-12", endDate: "2026-10-12" } }),
      ),
    ).toBe("Change of half day on Mon, 12 Oct 2026");
  });

  it("shows the Owner's reason on a decision against the member, never on an approval", () => {
    expect(
      leaveDecisionNote(request({ state: "rejected", decisionReason: "Shoot that week" })),
    ).toBe("The Owner's reason: Shoot that week");
    expect(
      leaveDecisionNote(request({ state: "cancelled", decisionReason: "Plans changed" })),
    ).toBe("The Owner's reason: Plans changed");
    expect(leaveDecisionNote(request({ state: "approved", decisionReason: "Enjoy" }))).toBeNull();
    expect(leaveDecisionNote(request({ state: "rejected" }))).toBeNull();
    // The replaced row still carries its approval note; that is not why it was replaced.
    expect(
      leaveDecisionNote(request({ state: "superseded", decisionReason: "ok, enjoy" })),
    ).toBeNull();
  });

  it("reads the system's own label for a cancellation the member asked for", () => {
    expect(
      leaveDecisionNote(request({ state: "cancelled", decisionReason: "cancellation approved" })),
    ).toBe("Cancelled at your request.");
  });

  it("calls a granted cancellation what it is for the member", () => {
    expect(leaveStateLabel(request({ state: "cancelled", requestsCancellation: true }))).toBe(
      "Leave cancelled",
    );
    expect(leaveStateLabel(request({ state: "cancelled" }))).toBe("Cancelled");
    expect(leaveStateLabel(request({ state: "submitted" }))).toBe("Waiting");
    expect(leaveStateLabel(request({ state: "superseded" }))).toBe("Replaced");
    expect(leaveStateLabel(request({ state: "rejected" }))).toBe("Not approved");
  });
});

const errorsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.join("."));

describe("requestLeaveSchema", () => {
  const schema = requestLeaveSchema(TODAY);

  it("accepts a range from today", () => {
    expect(
      schema.parse({ type: "leave", startDate: TODAY, endDate: "2026-09-26", reason: " Trip " }),
    ).toEqual({ type: "leave", startDate: TODAY, endDate: "2026-09-26", reason: "Trip" });
  });

  it("makes a half day one date, whatever end date came with it", () => {
    expect(
      schema.parse({ type: "half_day", startDate: "2026-09-30", endDate: "2026-10-02" }),
    ).toMatchObject({ startDate: "2026-09-30", endDate: "2026-09-30", reason: null });
  });

  it("makes a missing end date a single day", () => {
    expect(schema.parse({ type: "comp_leave", startDate: "2026-09-30" })).toMatchObject({
      endDate: "2026-09-30",
    });
  });

  it("refuses a start in the past and an end before the start", () => {
    expect(errorsOf(schema.safeParse({ type: "leave", startDate: "2026-09-23" }))).toEqual([
      "startDate",
    ]);
    expect(
      errorsOf(schema.safeParse({ type: "leave", startDate: "2026-09-28", endDate: "2026-09-27" })),
    ).toEqual(["endDate"]);
  });

  it("refuses an unknown type and a missing date", () => {
    expect(errorsOf(schema.safeParse({ type: "sick", startDate: TODAY }))).toEqual(["type"]);
    expect(errorsOf(schema.safeParse({ type: "leave", startDate: "" }))).toEqual(["startDate"]);
  });
});

describe("changeLeaveSchema", () => {
  it("may keep a start that has passed when it is the original's own", () => {
    const schema = changeLeaveSchema(TODAY, "2026-09-22");
    expect(
      schema.safeParse({ type: "leave", startDate: "2026-09-22", endDate: "2026-09-25" }).success,
    ).toBe(true);
    expect(
      errorsOf(schema.safeParse({ type: "leave", startDate: "2026-09-21", endDate: "2026-09-25" })),
    ).toEqual(["startDate"]);
  });

  it("must end today or later", () => {
    const schema = changeLeaveSchema(TODAY, "2026-09-22");
    expect(
      errorsOf(schema.safeParse({ type: "leave", startDate: "2026-09-22", endDate: "2026-09-23" })),
    ).toEqual(["endDate"]);
  });
});

describe("cancelLeaveSchema", () => {
  it("takes an optional reason", () => {
    expect(cancelLeaveSchema.parse({ requestId: BASE.id, reason: "  " })).toEqual({
      requestId: BASE.id,
      reason: null,
    });
  });
});
