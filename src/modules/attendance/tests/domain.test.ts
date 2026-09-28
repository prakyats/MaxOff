import { describe, expect, it } from "vitest";

import { PROMPT_LEAVE_CHOICES } from "../domain/choices";
import { chooseLeaveTodaySchema, submitNoteSchema } from "../domain/schemas";
import {
  dayLabel,
  describeTodayStrip,
  type OwnToday,
  promptDue,
  type TodayDay,
} from "../domain/today";

const BASE_DAY: TodayDay = {
  id: "00000000-0000-4000-8000-000000000001",
  workDate: "2026-09-23",
  state: "awaiting_choice",
  submittedChoice: null,
  finalStatus: null,
  isDayOff: false,
  proposedBySystem: false,
  decidedBySystem: true,
  decisionReason: null,
  workedOnLeave: false,
  overtimeFlag: false,
  overtimeReason: null,
  leaveType: null,
  startedAt: null,
  endedAt: null,
  endNotRecorded: false,
  firstLoginAt: null,
};

const BASE: OwnToday = {
  workDate: "2026-09-23",
  attendanceStarted: true,
  isWorkingDay: true,
  day: null,
  yesterdayOpen: null,
  coveringLeaveType: null,
};

// 9:12 am and 6:30 pm IST on the day.
const STARTED = "2026-09-23T03:42:00Z";
const ENDED = "2026-09-23T13:00:00Z";

const today = (patch: Partial<OwnToday>): OwnToday => ({ ...BASE, ...patch });
const withDay = (patch: Partial<TodayDay>): OwnToday => today({ day: { ...BASE_DAY, ...patch } });

describe("promptDue (PRODUCT §4.2, kickoff 3b decision 3)", () => {
  it("asks on a working day with no day yet, or one still without an answer", () => {
    expect(promptDue(today({}))).toBe(true);
    expect(promptDue(withDay({}))).toBe(true);
  });

  it("never asks on the joining day, on a day off, or once the day is recorded", () => {
    expect(promptDue(today({ attendanceStarted: false }))).toBe(false);
    expect(promptDue(today({ isWorkingDay: false }))).toBe(false);
    expect(promptDue(withDay({ isDayOff: true }))).toBe(false);
    expect(promptDue(withDay({ state: "pending_review", submittedChoice: "present" }))).toBe(false);
    expect(promptDue(withDay({ state: "pending_review", submittedChoice: "leave" }))).toBe(false);
    // A 2.x gate choice on the shared staging database counts as recorded (decision 28).
    expect(
      promptDue(
        withDay({ state: "pending_review", submittedChoice: "present", firstLoginAt: STARTED }),
      ),
    ).toBe(false);
  });

  it("never asks on a day of approved leave, full or half, whether or not a row exists yet", () => {
    for (const leaveType of ["leave", "half_day", "comp_leave"] as const) {
      expect(
        promptDue(
          withDay({ state: "approved", proposedBySystem: true, finalStatus: leaveType, leaveType }),
        ),
      ).toBe(false);
      expect(promptDue(today({ coveringLeaveType: leaveType }))).toBe(false);
    }
  });
});

describe("describeTodayStrip", () => {
  it("has nothing to decide on the joining day", () => {
    expect(describeTodayStrip(today({ attendanceStarted: false }))).toEqual({
      kind: "not_started",
      text: "Attendance starts tomorrow",
      dot: "none",
      action: null,
    });
  });

  it("offers Start day until the day is started or leave chosen", () => {
    expect(describeTodayStrip(today({}))).toEqual({
      kind: "start",
      text: "Not started",
      dot: "awaiting_choice",
      action: { kind: "start", label: "Start day" },
    });
    // A leave cancelled today hands the day back: the same offer.
    expect(describeTodayStrip(withDay({})).action).toEqual({ kind: "start", label: "Start day" });
  });

  it("says Day off and offers the day-off note, never Start day (decision 4)", () => {
    expect(describeTodayStrip(today({ isWorkingDay: false }))).toEqual({
      kind: "day_off",
      text: "Day off",
      dot: "none",
      action: { kind: "worked_day_off", label: "I worked today" },
    });
    // A day-off row a 2.x sign-in opened, no choice: still the note.
    expect(describeTodayStrip(withDay({ isDayOff: true })).kind).toBe("day_off");
  });

  it("carries the day's clock: started with End day, then ended", () => {
    const started = withDay({
      state: "pending_review",
      submittedChoice: "present",
      startedAt: STARTED,
    });
    expect(describeTodayStrip(started)).toEqual({
      kind: "started",
      text: "Started 9:12 am · waiting for approval",
      dot: "pending_review",
      action: { kind: "end", label: "End day" },
    });
    const ended = withDay({
      state: "pending_review",
      submittedChoice: "present",
      startedAt: STARTED,
      endedAt: ENDED,
    });
    expect(describeTodayStrip(ended)).toEqual({
      kind: "ended",
      text: "Present · ended 6:30 pm · waiting for approval",
      dot: "pending_review",
      action: null,
    });
    // Approved meanwhile: the standing follows.
    expect(
      describeTodayStrip(
        withDay({
          state: "approved",
          submittedChoice: "present",
          finalStatus: "present",
          startedAt: STARTED,
          endedAt: ENDED,
        }),
      ).text,
    ).toBe("Present · ended 6:30 pm · approved");
  });

  it("offers Start day on a Present recorded without one (a 2.x gate choice, decision 28)", () => {
    expect(
      describeTodayStrip(
        withDay({ state: "pending_review", submittedChoice: "present", firstLoginAt: STARTED }),
      ),
    ).toEqual({
      kind: "status",
      text: "Present · waiting for approval",
      dot: "pending_review",
      action: { kind: "start", label: "Start day" },
    });
  });

  it("offers End day for a day left open yesterday, when today has none", () => {
    expect(
      describeTodayStrip(today({ yesterdayOpen: { dayId: "y", startedAt: STARTED } })),
    ).toEqual({
      kind: "end_yesterday",
      text: "Yesterday not ended · started 9:12 am",
      dot: "pending_review",
      action: { kind: "end", label: "End day" },
    });
  });

  it("offers I'm working today on full and comp leave", () => {
    const onLeave = (leaveType: TodayDay["leaveType"]) =>
      describeTodayStrip(
        withDay({ state: "approved", proposedBySystem: true, finalStatus: leaveType, leaveType }),
      );
    expect(onLeave("leave")).toEqual({
      kind: "on_leave",
      text: "On leave today",
      dot: "leave",
      action: { kind: "working", label: "I'm working today" },
    });
    expect(onLeave("comp_leave")).toMatchObject({ text: "On comp leave today" });
    // Before anyone opens the row, the covering leave says the same.
    expect(describeTodayStrip(today({ coveringLeaveType: "leave" }))).toMatchObject({
      kind: "on_leave",
      text: "On leave today",
      action: { kind: "working" },
    });
    expect(describeTodayStrip(today({ coveringLeaveType: "half_day" }))).toMatchObject({
      kind: "half_day",
      text: "Half day today",
      action: { kind: "start" },
    });
  });

  it("keeps Start day and End day available on a half-day leave day (PRODUCT §4.2)", () => {
    const half = (patch: Partial<TodayDay>) =>
      describeTodayStrip(
        withDay({
          state: "approved",
          proposedBySystem: true,
          finalStatus: "half_day",
          leaveType: "half_day",
          ...patch,
        }),
      );
    expect(half({})).toEqual({
      kind: "half_day",
      text: "Half day today",
      dot: "half_day",
      action: { kind: "start", label: "Start day" },
    });
    expect(half({ startedAt: STARTED })).toMatchObject({
      text: "Half day today · started 9:12 am",
      action: { kind: "end" },
    });
    expect(half({ startedAt: STARTED, endedAt: ENDED })).toMatchObject({
      text: "Half day today · ended 6:30 pm",
      action: null,
    });
  });

  it("reads status · standing for everything else, in the words the app already uses", () => {
    expect(
      describeTodayStrip(withDay({ state: "pending_review", submittedChoice: "half_day" })),
    ).toMatchObject({ text: "Half day · waiting for approval", action: { kind: "start" } });
    expect(describeTodayStrip(withDay({ state: "pending_review", finalStatus: "absent" }))).toEqual(
      {
        kind: "status",
        text: "Absent (proposed) · waiting for approval",
        dot: "pending_review",
        action: null,
      },
    );
    expect(
      describeTodayStrip(withDay({ state: "pending_review", submittedChoice: "leave" })).action,
    ).toBeNull();
  });

  it("says who changed a corrected day", () => {
    expect(
      describeTodayStrip(
        withDay({ state: "corrected", finalStatus: "absent", decidedBySystem: false }),
      ),
    ).toEqual({
      kind: "status",
      text: "Absent · corrected by the Owner",
      dot: "corrected",
      action: null,
    });
    expect(
      describeTodayStrip(
        withDay({ state: "corrected", finalStatus: "leave", decidedBySystem: true }),
      ).text,
    ).toBe("Leave · your leave was approved");
  });

  it("keeps Present on an approved-leave day as a worked day, not as leave", () => {
    expect(
      describeTodayStrip(
        withDay({
          state: "pending_review",
          submittedChoice: "present",
          proposedBySystem: true,
          leaveType: "leave",
          startedAt: STARTED,
        }),
      ).text,
    ).toBe("Started 9:12 am · waiting for approval");
  });
});

describe("dayLabel", () => {
  it("names the IST date", () => {
    expect(dayLabel("2026-09-23")).toBe("Wednesday, 23 September");
  });
});

describe("schemas", () => {
  it("offers Leave and Half day at the prompt, never Present or comp leave (decision 16)", () => {
    expect(PROMPT_LEAVE_CHOICES).toEqual(["leave", "half_day"]);
    expect(chooseLeaveTodaySchema.safeParse({ choice: "leave" }).success).toBe(true);
    expect(chooseLeaveTodaySchema.parse({ choice: "half_day", reason: "  " }).reason).toBeNull();
    for (const choice of ["", "present", "comp_leave", "absent"]) {
      expect(chooseLeaveTodaySchema.safeParse({ choice }).success, choice).toBe(false);
    }
  });

  it("needs the day and what was worked on for an extra work note; the duration is optional", () => {
    expect(
      submitNoteSchema.safeParse({ kind: "overtime", workDate: "2026-09-23", note: "Colour grade" })
        .success,
    ).toBe(true);
    expect(
      submitNoteSchema.parse({ kind: "day_off", workDate: "2026-09-20", note: "Sunday shoot" })
        .durationMinutes,
    ).toBeNull();
    expect(
      submitNoteSchema.safeParse({ kind: "overtime", workDate: "2026-09-23", note: " x " }).success,
    ).toBe(false);
    expect(
      submitNoteSchema.safeParse({
        kind: "overtime",
        workDate: "2026-09-23",
        note: "Edit",
        durationMinutes: 45,
      }).success,
    ).toBe(false);
  });
});
