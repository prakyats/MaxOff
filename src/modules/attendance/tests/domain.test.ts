import { describe, expect, it } from "vitest";

import { DAY_CHANGED_MESSAGE } from "../domain/choices";
import { flagOvertimeSchema, submitChoiceSchema } from "../domain/schemas";
import { dayLabel, describeTodayStrip, type TodayDay } from "../domain/today";

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

describe("describeTodayStrip", () => {
  it("has nothing to decide on the joining day (no day row)", () => {
    expect(describeTodayStrip(null)).toEqual({
      kind: "not_started",
      text: "Attendance starts tomorrow",
      dot: "none",
    });
  });

  it("offers the choice again when the day is back at the gate", () => {
    expect(describeTodayStrip(day({}))).toEqual({
      kind: "choose",
      text: "Not chosen yet · choose now",
      dot: "awaiting_choice",
    });
  });

  it("offers I'm working today on full and comp leave, and the full day on a half day", () => {
    const onLeave = (leaveType: TodayDay["leaveType"]) =>
      describeTodayStrip(
        day({ state: "approved", proposedBySystem: true, finalStatus: leaveType, leaveType }),
      );
    expect(onLeave("leave")).toMatchObject({
      kind: "on_leave",
      text: "On leave today",
      workingLabel: "I'm working today",
    });
    expect(onLeave("comp_leave")).toMatchObject({ workingLabel: "I'm working today" });
    expect(onLeave("half_day")).toMatchObject({
      text: "Half day today",
      workingLabel: "I'm working the full day",
    });
  });

  it("reads status · standing, in the words the app already uses", () => {
    expect(
      describeTodayStrip(day({ state: "pending_review", submittedChoice: "present" })),
    ).toEqual({ kind: "status", text: "Present · waiting for approval", dot: "pending_review" });
    expect(
      describeTodayStrip(day({ state: "pending_review", submittedChoice: "half_day" })).text,
    ).toBe("Half day · waiting for approval");
    expect(describeTodayStrip(day({ state: "pending_review", finalStatus: "absent" })).text).toBe(
      "Absent (proposed) · waiting for approval",
    );
    expect(
      describeTodayStrip(
        day({ state: "approved", submittedChoice: "present", finalStatus: "present" }),
      ),
    ).toEqual({ kind: "status", text: "Present · approved", dot: "present" });
  });

  it("says who changed a corrected day", () => {
    expect(
      describeTodayStrip(day({ state: "corrected", finalStatus: "absent", decidedBySystem: false }))
        .text,
    ).toBe("Absent · corrected by the Owner");
    expect(
      describeTodayStrip(day({ state: "corrected", finalStatus: "leave", decidedBySystem: true }))
        .text,
    ).toBe("Leave · your leave was approved");
  });

  it("keeps Present on an approved-leave day as a worked day, not as leave", () => {
    expect(
      describeTodayStrip(
        day({
          state: "pending_review",
          submittedChoice: "present",
          proposedBySystem: true,
          leaveType: "leave",
        }),
      ).text,
    ).toBe("Present · waiting for approval");
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
