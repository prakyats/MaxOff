import { describe, expect, it } from "vitest";

import { DAY_CHANGED_MESSAGE } from "../domain/choices";
import { flagOvertimeSchema, submitChoiceSchema } from "../domain/schemas";
import { dayLabel, describeToday, type TodayDay } from "../domain/today";

const BASE: TodayDay = {
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
};

const day = (patch: Partial<TodayDay>): TodayDay => ({ ...BASE, ...patch });

describe("describeToday", () => {
  it("has nothing to show on the joining day (no day row)", () => {
    expect(describeToday(null)).toEqual({ kind: "not_started" });
  });

  it("offers the choice again when the day is back at the gate", () => {
    expect(describeToday(day({ isDayOff: true }))).toEqual({ kind: "choose", dayOff: true });
  });

  it("offers I'm working today on full and comp leave, and the full day on a half day", () => {
    const derived = { state: "approved", proposedBySystem: true, finalStatus: "leave" } as const;
    expect(describeToday(day({ ...derived, leaveType: "leave" }))).toMatchObject({
      kind: "on_leave",
      title: "You're on approved leave today",
      workingLabel: "I'm working today",
    });
    expect(describeToday(day({ ...derived, leaveType: "comp_leave" }))).toMatchObject({
      workingLabel: "I'm working today",
    });
    expect(
      describeToday(day({ ...derived, finalStatus: "half_day", leaveType: "half_day" })),
    ).toMatchObject({
      kind: "on_leave",
      title: "You're on an approved half day today",
      workingLabel: "I'm working the full day",
    });
  });

  it("shows a submitted choice as waiting for approval", () => {
    expect(
      describeToday(day({ state: "pending_review", submittedChoice: "half_day" })),
    ).toMatchObject({
      kind: "status",
      state: "pending_review",
      title: "Half day, waiting for approval",
    });
  });

  it("says a proposed absence plainly", () => {
    expect(
      describeToday(
        day({ state: "pending_review", finalStatus: "absent", proposedBySystem: true }),
      ),
    ).toMatchObject({ title: "No choice recorded: proposed absent, waiting for review" });
  });

  it("marks work on a day off", () => {
    expect(
      describeToday(day({ state: "pending_review", submittedChoice: "present", isDayOff: true })),
    ).toMatchObject({ detail: "Worked on a day off.", dayOff: true });
    expect(
      describeToday(
        day({
          state: "approved",
          submittedChoice: "present",
          finalStatus: "present",
          isDayOff: true,
        }),
      ),
    ).toMatchObject({ title: "Present, approved", detail: "Worked on a day off." });
  });

  it("says who corrected the day and why", () => {
    expect(
      describeToday(
        day({
          state: "corrected",
          finalStatus: "leave",
          decisionReason: "leave approved",
          proposedBySystem: true,
        }),
      ),
    ).toMatchObject({ title: "Leave, corrected", detail: "Updated: leave approved." });
    expect(
      describeToday(
        day({
          state: "corrected",
          finalStatus: "present",
          decidedBySystem: false,
          decisionReason: "In the studio",
        }),
      ),
    ).toMatchObject({ title: "Present, corrected", detail: "The Owner's note: In the studio" });
  });

  it("keeps Present on an approved-leave day as a worked day, not as leave", () => {
    expect(
      describeToday(
        day({
          state: "approved",
          submittedChoice: "present",
          finalStatus: "present",
          workedOnLeave: true,
          leaveType: "leave",
        }),
      ),
    ).toMatchObject({ kind: "status", detail: "Worked on a day of approved leave." });
  });
});

describe("dayLabel", () => {
  it("names the IST date", () => {
    expect(dayLabel("2026-09-23")).toBe("Wednesday, 23 September");
  });
});

describe("schemas", () => {
  it("needs one of the four choices and a date; the reason is optional", () => {
    expect(submitChoiceSchema.safeParse({ choice: "present", forDate: "2026-09-23" }).success).toBe(
      true,
    );
    const parsed = submitChoiceSchema.parse({
      choice: "leave",
      reason: "  ",
      forDate: "2026-09-23",
    });
    expect(parsed.reason).toBeNull();
    for (const input of [
      { choice: "", forDate: "2026-09-23" },
      { choice: "absent", forDate: "2026-09-23" },
      { choice: "present", forDate: "23/09/2026" },
    ]) {
      expect(submitChoiceSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });

  it("needs a reason to flag overtime", () => {
    expect(flagOvertimeSchema.safeParse({ dayId: BASE.id, reason: "Shoot ran late" }).success).toBe(
      true,
    );
    expect(flagOvertimeSchema.safeParse({ dayId: BASE.id, reason: " x " }).success).toBe(false);
  });

  it("matches the database's day-changed message word for word", () => {
    expect(DAY_CHANGED_MESSAGE).toBe("The day changed. Choose again for today.");
  });
});
