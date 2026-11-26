import { describe, expect, it } from "vitest";

import {
  assignmentWarnings,
  availabilityDays,
  type AvailabilityDay,
  type EventBlock,
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

/** 10:00–12:00 IST on 3 Oct, a shoot Nikhil Rao booked. */
const SHOOT = {
  startAt: "2026-10-03T04:30:00.000Z",
  endAt: "2026-10-03T06:30:00.000Z",
  typeName: "Shoot",
  bookedById: "nikhil",
  bookedByName: " Nikhil  Rao ",
};
const VIEWER = "sana";
const OWNER = "owner";

/** The keys `task_create` accepts in an overlap's details (migration phase4_review_fixes). */
const OVERLAP_KEYS = ["date", "start_at", "end_at"];

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
    expect(warning).toEqual({
      kind: "overlap",
      memberId: "asha",
      details: { date: DAY, start_at: SHOOT.startAt, end_at: SHOOT.endAt },
      text: "Clashes: Shoot 10:00 am – 12:00 pm · booked by Nikhil Rao",
    });
  });

  it("a clash names the booking as the picker does: its type, time and who booked it (v6.0)", () => {
    const base = {
      memberIds: ["asha"],
      dueDate: null,
      eventDate: DAY,
      eventWindow: eventWindow("2026-10-03T05:00:00.000Z", null),
      threshold: 4,
      viewerId: VIEWER,
      ownerId: OWNER,
    };
    const text = (block: Partial<EventBlock>) =>
      assignmentWarnings({
        ...base,
        availability: [row({ eventBlocks: [{ ...SHOOT, ...block }] })],
      })[0]?.text;
    // The viewer's own booking, the Owner's, and someone else's by their full name.
    expect(text({ bookedById: VIEWER })).toBe("Clashes: Shoot 10:00 am – 12:00 pm · booked by you");
    expect(text({ bookedById: OWNER, bookedByName: "Prishit Shetty" })).toBe(
      "Clashes: Shoot 10:00 am – 12:00 pm · booked by Owner",
    );
    expect(text({ typeName: "Meeting" })).toBe(
      "Clashes: Meeting 10:00 am – 12:00 pm · booked by Nikhil Rao",
    );
    // A date-only booking reads all day; an unknown booker is left out, an unknown type is "Event".
    expect(text({ startAt: null, endAt: null })).toBe(
      "Clashes: Shoot all day · booked by Nikhil Rao",
    );
    expect(text({ typeName: null, bookedById: null, bookedByName: null })).toBe(
      "Clashes: Event 10:00 am – 12:00 pm",
    );
  });

  it("never warns about a window that only touches", () => {
    const touching = { startAt: SHOOT.endAt, endAt: "2026-10-03T07:30:00.000Z" };
    expect(
      assignmentWarnings({
        memberIds: ["asha"],
        dueDate: null,
        eventDate: DAY,
        eventWindow: touching,
        threshold: 4,
        availability: [row({ eventBlocks: [SHOOT] })],
      }),
    ).toEqual([]);
  });

  it("a date-only event is busy all day: it clashes with anything that day (v6.0, owner 13 Nov 2026)", () => {
    const base = { memberIds: ["asha"], dueDate: null, eventDate: DAY, threshold: 4 };
    const allDay = { startAt: null, endAt: null };
    // A new date-only event against a timed booking: the booking's time is named.
    expect(
      assignmentWarnings({
        ...base,
        eventWindow: null,
        availability: [row({ eventBlocks: [SHOOT] })],
      }),
    ).toMatchObject([
      { kind: "overlap", text: "Clashes: Shoot 10:00 am – 12:00 pm · booked by Nikhil Rao" },
    ]);
    // A timed event against a date-only booking, and a date-only one against another. What is
    // recorded is only what `task_create` accepts for an overlap: the date alone.
    const dated = { ...allDay, typeName: "Meeting", bookedById: VIEWER, bookedByName: "Sana Khan" };
    for (const window of [eventWindow("2026-10-03T10:00:00.000Z", null), null]) {
      const warnings = assignmentWarnings({
        ...base,
        eventWindow: window,
        viewerId: VIEWER,
        ownerId: OWNER,
        availability: [row({ eventBlocks: [dated] })],
      });
      expect(warnings).toEqual([
        {
          kind: "overlap",
          memberId: "asha",
          details: { date: DAY },
          text: "Clashes: Meeting all day · booked by you",
        },
      ]);
      for (const warning of warningsPayload(warnings)) {
        expect(Object.keys(warning.details).every((key) => OVERLAP_KEYS.includes(key))).toBe(true);
      }
    }
    // Nothing on that day: no clash; another day's booking is not this day's.
    expect(assignmentWarnings({ ...base, eventWindow: null, availability: [row({})] })).toEqual([]);
    expect(
      assignmentWarnings({
        ...base,
        eventWindow: null,
        availability: [row({ day: "2026-10-04", eventBlocks: [allDay] })],
      }),
    ).toEqual([]);
  });

  it("editing: the task's own block is no clash, timed or date-only, and only once", () => {
    const allDay = { startAt: null, endAt: null };
    const base = { memberIds: ["asha"], dueDate: null, eventDate: DAY, threshold: 4 };
    const current = { memberIds: ["asha"], dueDate: DAY, eventDate: DAY, open: true };
    expect(
      assignmentWarnings({
        ...base,
        eventWindow: null,
        availability: [row({ eventBlocks: [allDay] })],
        current: { ...current, eventWindow: null },
      }),
    ).toEqual([]);
    expect(
      assignmentWarnings({
        ...base,
        eventWindow: null,
        availability: [row({ eventBlocks: [allDay, allDay] })],
        current: { ...current, eventWindow: null },
      }),
    ).toHaveLength(1);
    expect(
      assignmentWarnings({
        ...base,
        eventWindow: SHOOT,
        availability: [row({ eventBlocks: [SHOOT] })],
        current: { ...current, eventWindow: SHOOT },
      }),
    ).toEqual([]);
    // Made date-only from timed: its own timed block still is not a clash against itself.
    expect(
      assignmentWarnings({
        ...base,
        eventWindow: null,
        availability: [row({ eventBlocks: [SHOOT] })],
        current: { ...current, eventWindow: SHOOT },
      }),
    ).toEqual([]);
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
