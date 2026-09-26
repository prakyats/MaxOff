import { describe, expect, it } from "vitest";

import { describeEvent, describeHistoryDay, firstName, type HistoryDay } from "../domain/history";
import {
  approvedLabel,
  expectedToday,
  boardStatus,
  type PendingDay,
  pendingLabel,
  pendingOutcome,
  sortPending,
  summariseToday,
  todayBucket,
  type TodayPerson,
} from "../domain/review";
import { correctDaySchema } from "../domain/schemas";

const PERSON: TodayPerson = {
  memberId: "m-1",
  name: "Asha Rao",
  jobTitle: "Editor",
  started: true,
  dayId: null,
  state: null,
  finalStatus: null,
  submittedChoice: null,
  firstLoginAt: null,
  lastLogoutAt: null,
  logoutNotRecorded: false,
  overtimeFlag: false,
  isDayOff: false,
  onLeave: false,
  leaveType: null,
};
const person = (patch: Partial<TodayPerson>): TodayPerson => ({ ...PERSON, ...patch });

describe("todayBucket: the four counts of today's card (WORKFLOWS §1 'Settled in 2.4')", () => {
  it("waiting for a decision beats everything, a Present on a leave day included", () => {
    expect(
      todayBucket(person({ dayId: "d", state: "pending_review", submittedChoice: "present" })),
    ).toBe("waiting");
    expect(
      todayBucket(
        person({ dayId: "d", state: "pending_review", submittedChoice: "present", onLeave: true }),
      ),
    ).toBe("waiting");
  });

  it("not chosen yet: signed in without choosing, or not signed in at all", () => {
    expect(todayBucket(person({ dayId: "d", state: "awaiting_choice" }))).toBe("not_chosen");
    expect(todayBucket(person({}))).toBe("not_chosen");
  });

  it("present and on leave follow the decided outcome", () => {
    expect(todayBucket(person({ dayId: "d", state: "approved", finalStatus: "present" }))).toBe(
      "present",
    );
    expect(todayBucket(person({ dayId: "d", state: "corrected", finalStatus: "present" }))).toBe(
      "present",
    );
    for (const status of ["leave", "half_day", "comp_leave"] as const) {
      expect(todayBucket(person({ dayId: "d", state: "approved", finalStatus: status }))).toBe(
        "on_leave",
      );
    }
  });

  it("approved leave counts before the person signs in; they are not 'not chosen'", () => {
    expect(todayBucket(person({ onLeave: true, leaveType: "leave" }))).toBe("on_leave");
  });

  it("puts a decided absence in Absent, which is on the board but not on the card", () => {
    expect(todayBucket(person({ dayId: "d", state: "corrected", finalStatus: "absent" }))).toBe(
      "absent",
    );
    expect(todayBucket(person({ dayId: "d", state: "approved", finalStatus: "absent" }))).toBe(
      "absent",
    );
    const summary = summariseToday(
      [person({ dayId: "d", state: "approved", finalStatus: "absent" })],
      false,
    );
    expect(summary.counts).toEqual({ waiting: 0, not_chosen: 0, present: 0, on_leave: 0 });
    expect(summary.board.map((group) => group.bucket)).toEqual(["absent"]);
  });

  it("leaves out only whoever is not expected: the joining day, and a day off not come in", () => {
    expect(todayBucket(person({ started: false }))).toBeNull();
    expect(todayBucket(person({ isDayOff: true }))).toBeNull();
    expect(todayBucket(person({ isDayOff: true, onLeave: true }))).toBeNull();
  });

  it("on a day off, those who came in still count", () => {
    expect(todayBucket(person({ isDayOff: true, dayId: "d", state: "awaiting_choice" }))).toBe(
      "not_chosen",
    );
    expect(
      todayBucket(
        person({ isDayOff: true, dayId: "d", state: "pending_review", submittedChoice: "present" }),
      ),
    ).toBe("waiting");
  });
});

describe("summariseToday: the card and the board from one read", () => {
  const people = [
    person({ memberId: "1", name: "Zara", dayId: "d1", state: "approved", finalStatus: "present" }),
    person({ memberId: "2", name: "Bala", onLeave: true, leaveType: "leave" }),
    person({ memberId: "3", name: "Chitra" }),
    person({
      memberId: "4",
      name: "Dev",
      dayId: "d4",
      state: "pending_review",
      submittedChoice: "leave",
    }),
    person({ memberId: "5", name: "Asha", dayId: "d5", state: "approved", finalStatus: "present" }),
    person({ memberId: "6", name: "New", started: false }),
    person({
      memberId: "7",
      name: "Eshwar",
      dayId: "d7",
      state: "pending_review",
      submittedChoice: "present",
    }),
  ];

  it("counts each bucket once", () => {
    expect(summariseToday(people, false).counts).toEqual({
      waiting: 2,
      not_chosen: 1,
      present: 2,
      on_leave: 1,
    });
  });

  it("orders the board by what needs the Owner, then by name", () => {
    const board = summariseToday(people, false).board;
    expect(board.map((group) => group.bucket)).toEqual([
      "waiting",
      "not_chosen",
      "present",
      "on_leave",
    ]);
    expect(board.map((group) => group.people.map((p) => p.name))).toEqual([
      ["Dev", "Eshwar"],
      ["Chitra"],
      ["Asha", "Zara"],
      ["Bala"],
    ]);
  });

  it("drops empty groups and keeps the day-off flag for the card", () => {
    const summary = summariseToday([person({ isDayOff: true })], true);
    expect(summary.isDayOff).toBe(true);
    expect(summary.board).toEqual([]);
    expect(summary.counts).toEqual({ waiting: 0, not_chosen: 0, present: 0, on_leave: 0 });
  });

  it("names each row's status in words", () => {
    expect(boardStatus(person({ submittedChoice: "half_day" }), "waiting")).toBe("Half day");
    expect(boardStatus(person({}), "waiting")).toBe("Absent (proposed)");
    expect(boardStatus(person({ dayId: "d" }), "not_chosen")).toBe("Signed in");
    expect(boardStatus(person({}), "not_chosen")).toBe("Not signed in");
    expect(boardStatus(person({ leaveType: "comp_leave" }), "on_leave")).toBe("Comp leave");
  });
});

const PENDING: PendingDay = {
  id: "a",
  memberId: "m",
  memberName: "Asha Rao",
  workDate: "2026-09-24",
  submittedChoice: "present",
  finalStatus: null,
  proposedBySystem: false,
  onApprovedLeave: false,
  isDayOff: false,
  firstLoginAt: null,
  note: null,
  submittedAt: "2026-09-24T03:40:00Z",
};
const pending = (patch: Partial<PendingDay>): PendingDay => ({ ...PENDING, ...patch });

describe("the Attendance group's rows", () => {
  it("says what approving would record", () => {
    expect(pendingOutcome(pending({}))).toBe("present");
    expect(pendingOutcome(pending({ submittedChoice: null, finalStatus: "absent" }))).toBe(
      "absent",
    );
    expect(pendingLabel(pending({ submittedChoice: null, finalStatus: "absent" }))).toBe(
      "Absent (proposed)",
    );
    expect(pendingLabel(pending({ onApprovedLeave: true }))).toBe("Present on a leave day");
    expect(pendingLabel(pending({ isDayOff: true }))).toBe("Present on a day off");
    expect(approvedLabel(pending({ submittedChoice: "half_day" }))).toBe(
      "Approved Asha's half day",
    );
  });

  it("orders oldest first: by date, then by when it was sent", () => {
    const sorted = sortPending([
      pending({ id: "c", workDate: "2026-09-24", submittedAt: "2026-09-24T05:00:00Z" }),
      pending({ id: "a", workDate: "2026-09-23", submittedAt: "2026-09-23T09:00:00Z" }),
      pending({ id: "b", workDate: "2026-09-24", submittedAt: "2026-09-24T03:00:00Z" }),
    ]);
    expect(sorted.map((day) => day.id)).toEqual(["a", "b", "c"]);
  });
});

describe("the history in the Owner's words (one vocabulary, turned around)", () => {
  const owner = { kind: "owner" as const, name: "Asha Rao" };
  const base = {
    id: 1,
    fromStatus: null,
    toStatus: "leave" as const,
    reason: null,
    at: "2026-09-24T03:40:00Z",
  };

  it("names the person where the member reads 'you'", () => {
    expect(
      describeEvent({ ...base, action: "submitted", actor: "you", reason: "Fever" }, owner),
    ).toEqual({
      text: "Asha chose leave",
      note: "Asha's note: Fever",
    });
    expect(
      describeEvent(
        { ...base, action: "submitted", actor: "you", fromStatus: "leave", toStatus: "present" },
        owner,
      ).text,
    ).toBe("Asha said they're working on a day of approved leave");
    expect(
      describeEvent({ ...base, action: "overtime_flagged", actor: "you", reason: "Launch" }, owner),
    ).toEqual({
      text: "Asha flagged overtime",
      note: "Asha's note: Launch",
    });
  });

  it("speaks to the Owner as 'you'", () => {
    expect(describeEvent({ ...base, action: "approved", actor: "owner" }, owner).text).toBe(
      "You approved leave",
    );
    expect(
      describeEvent(
        { ...base, action: "corrected", actor: "owner", toStatus: "absent", reason: "Not in" },
        owner,
      ),
    ).toEqual({ text: "You changed it to absent", note: "Your reason: Not in" });
  });

  it("keeps the system's own changes in the same words", () => {
    expect(
      describeEvent(
        { ...base, action: "corrected", actor: "system", reason: "leave approved" },
        owner,
      ).text,
    ).toBe("Changed to leave: their leave request was approved");
    expect(
      describeEvent(
        {
          ...base,
          action: "corrected",
          actor: "system",
          reason: "leave cancelled",
          toStatus: null,
        },
        owner,
      ).text,
    ).toBe("Their leave was cancelled, so the day asked for a choice again");
  });

  it("tells the Owner a waiting day waits for them", () => {
    const day: HistoryDay = {
      id: "d",
      workDate: "2026-09-24",
      state: "pending_review",
      submittedChoice: "present",
      finalStatus: null,
      isDayOff: false,
      workedOnLeave: false,
      firstLoginAt: null,
      lastLogoutAt: null,
      logoutNotRecorded: false,
      overtimeFlag: false,
      overtimeReason: null,
      events: [],
    };
    expect(describeHistoryDay(day, owner).standing).toBe("Waiting for you");
    expect(describeHistoryDay(day).standing).toBe("Waiting for the Owner");
    expect(
      describeHistoryDay(
        {
          ...day,
          state: "corrected",
          finalStatus: "absent",
          events: [{ ...base, action: "corrected", actor: "owner", toStatus: "absent" }],
        },
        owner,
      ).standing,
    ).toBe("Changed by you");
  });

  it("uses the first name in a sentence", () => {
    expect(firstName("Asha Rao")).toBe("Asha");
    expect(firstName("  Madhu  ")).toBe("Madhu");
  });
});

describe("correctDaySchema: a correction always asks for a reason", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("accepts a status and a reason", () => {
    expect(correctDaySchema.parse({ dayId: id, status: "absent", reason: " Not in " })).toEqual({
      dayId: id,
      status: "absent",
      reason: "Not in",
    });
  });
  it("refuses no status and a missing reason, with the field's own message", () => {
    const result = correctDaySchema.safeParse({ dayId: id, status: "", reason: " " });
    expect(result.success).toBe(false);
    const fields = result.error?.issues.map((issue) => issue.path.join("."));
    expect(fields).toEqual(expect.arrayContaining(["status", "reason"]));
  });
});

describe("the board never drops anyone expected today", () => {
  const states = [null, "awaiting_choice", "pending_review", "approved", "corrected"] as const;
  const statuses = [null, "present", "leave", "half_day", "comp_leave", "absent"] as const;
  const everyone: TodayPerson[] = [];
  let n = 0;
  for (const started of [true, false])
    for (const isDayOff of [false, true])
      for (const onLeave of [false, true])
        for (const state of states)
          for (const finalStatus of statuses) {
            n += 1;
            everyone.push(
              person({
                memberId: `m-${n}`,
                name: `Person ${n}`,
                started,
                isDayOff,
                onLeave,
                leaveType: onLeave ? "leave" : null,
                state,
                dayId: state === null ? null : `d-${n}`,
                finalStatus:
                  state === "approved" || state === "corrected" ? (finalStatus ?? "present") : null,
                submittedChoice: state === "pending_review" ? "present" : null,
              }),
            );
          }

  it("places every expected person in exactly one group, and nobody else", () => {
    const { board } = summariseToday(everyone, false);
    const placed = board.flatMap((group) => group.people.map((p) => p.memberId));
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.sort()).toEqual(
      everyone
        .filter(expectedToday)
        .map((p) => p.memberId)
        .sort(),
    );
  });

  it("counts on the card everyone on the board except the Absent group", () => {
    const { board, counts } = summariseToday(everyone, false);
    const onCard = board
      .filter((group) => group.bucket !== "absent")
      .reduce((total, group) => total + group.people.length, 0);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(onCard);
  });
});
