import { describe, expect, it } from "vitest";

import {
  assignmentWarnings,
  availabilityDays,
  type AvailabilityDay,
  eventWindow,
  warningsPayload,
  warningsToRecord,
} from "../domain/warnings";

const DAY = "2026-10-03";

function row(overrides: Partial<AvailabilityDay>): AvailabilityDay {
  return {
    memberId: "asha",
    day: DAY,
    openTasksDue: 0,
    eventBlocks: [],
    leave: null,
    ...overrides,
  };
}

/** 10:00–12:00 IST on 3 Oct. */
const SHOOT = { startAt: "2026-10-03T04:30:00.000Z", endAt: "2026-10-03T06:30:00.000Z" };

describe("assignment warnings (WORKFLOWS §3.1, kickoff 4 decisions 11–13)", () => {
  it("warns about workload at the threshold, not below it", () => {
    const base = {
      memberIds: ["asha"],
      dueDate: DAY,
      eventDate: null,
      eventWindow: null,
      threshold: 4,
    };
    expect(assignmentWarnings({ ...base, availability: [row({ openTasksDue: 3 })] })).toEqual([]);
    const [warning] = assignmentWarnings({ ...base, availability: [row({ openTasksDue: 4 })] });
    expect(warning).toMatchObject({
      kind: "workload",
      memberId: "asha",
      details: { date: DAY, open_tasks: 4, threshold: 4 },
      text: "4 tasks already due on 3 Oct",
    });
  });

  it("warns about an overlapping event, with no end counting as one hour", () => {
    const window = eventWindow("2026-10-03T06:00:00.000Z", null); // 11:30–12:30 IST
    expect(window).toEqual({
      startAt: "2026-10-03T06:00:00.000Z",
      endAt: "2026-10-03T07:00:00.000Z",
    });
    const [warning] = assignmentWarnings({
      memberIds: ["asha"],
      dueDate: null,
      eventDate: DAY,
      eventWindow: window,
      threshold: 4,
      availability: [row({ eventBlocks: [SHOOT] })],
    });
    expect(warning).toMatchObject({ kind: "overlap", text: "Busy 10:00 AM–12:00 PM on 3 Oct" });
  });

  it("never warns about an overlap for a date-only event or a window that only touches", () => {
    const touching = { startAt: SHOOT.endAt, endAt: "2026-10-03T07:30:00.000Z" };
    for (const window of [null, touching]) {
      expect(
        assignmentWarnings({
          memberIds: ["asha"],
          dueDate: null,
          eventDate: DAY,
          eventWindow: window,
          threshold: 4,
          availability: [row({ eventBlocks: [SHOOT] })],
        }),
      ).toEqual([]);
    }
  });

  it("warns about approved leave and about a pending request, on the deadline's day first", () => {
    const warnings = assignmentWarnings({
      memberIds: ["asha", "ravi"],
      dueDate: DAY,
      eventDate: "2026-10-05",
      eventWindow: null,
      threshold: 4,
      availability: [
        row({ leave: "half_day" }),
        row({ day: "2026-10-05", leave: "leave" }),
        row({ memberId: "ravi", day: "2026-10-05", leave: "requested" }),
      ],
    });
    expect(warnings.map((w) => [w.memberId, w.kind, w.text])).toEqual([
      ["asha", "on_leave", "On a half day on 3 Oct"],
      ["ravi", "on_leave", "Leave requested on 5 Oct"],
    ]);
  });

  it("gives a freelancer no leave warning: their availability carries none", () => {
    expect(
      assignmentWarnings({
        memberIds: ["asha"],
        dueDate: DAY,
        eventDate: null,
        eventWindow: null,
        threshold: 4,
        availability: [row({ leave: null, openTasksDue: 1 })],
      }),
    ).toEqual([]);
  });

  it("does not count the task being edited against the people already on it", () => {
    const current = {
      memberIds: ["asha"],
      dueDate: DAY,
      eventDate: DAY,
      eventWindow: SHOOT,
      open: true,
    };
    const input = {
      memberIds: ["asha", "ravi"],
      dueDate: DAY,
      eventDate: DAY,
      eventWindow: SHOOT,
      threshold: 2,
      availability: [
        row({ openTasksDue: 2, eventBlocks: [SHOOT] }),
        row({ memberId: "ravi", openTasksDue: 2, eventBlocks: [SHOOT] }),
      ],
      current,
    };
    // Asha: one other task (below 2) and only her own block; Ravi is new, so both count.
    expect(assignmentWarnings(input).map((w) => [w.memberId, w.kind])).toEqual([
      ["ravi", "workload"],
      ["ravi", "overlap"],
    ]);
  });

  it("records, on an edit, the people added, or everyone when the dates moved", () => {
    const warnings = assignmentWarnings({
      memberIds: ["asha", "ravi"],
      dueDate: DAY,
      eventDate: null,
      eventWindow: null,
      threshold: 1,
      availability: [row({ openTasksDue: 3 }), row({ memberId: "ravi", openTasksDue: 3 })],
    });
    expect(warningsToRecord(warnings, { added: ["ravi"], datesMoved: false })).toHaveLength(1);
    expect(warningsToRecord(warnings, { added: [], datesMoved: true })).toHaveLength(2);
    expect(warningsPayload(warnings)[0]).toEqual({
      kind: "workload",
      member_id: "asha",
      details: { date: DAY, open_tasks: 3, threshold: 1 },
    });
  });

  it("asks for the deadline's and the event's days, once each", () => {
    expect(availabilityDays(DAY, DAY)).toEqual([DAY]);
    expect(availabilityDays(null, DAY)).toEqual([DAY]);
    expect(availabilityDays(DAY, "2026-10-05")).toEqual([DAY, "2026-10-05"]);
    expect(availabilityDays(null, null)).toEqual([]);
  });
});
