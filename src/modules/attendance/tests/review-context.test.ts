import { describe, expect, it } from "vitest";

import { contextStatus, reviewWeek, weekAround, type ContextDay } from "../domain/review-context";

const day = (workDate: string, over: Partial<ContextDay> = {}): ContextDay => ({
  workDate,
  state: "approved",
  submittedChoice: "present",
  finalStatus: "present",
  ...over,
});

describe("the Review panel's week (B4)", () => {
  it("is the IST week, Monday to Sunday, that holds the day", () => {
    expect(weekAround("2026-10-21")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(weekAround("2026-10-19")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(weekAround("2026-10-25")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
  });

  it("reads each day by its outcome, or what waits, and marks the reviewed day", () => {
    const week = reviewWeek(
      [
        day("2026-10-19"),
        day("2026-10-20", { state: "corrected", finalStatus: "leave" }),
        day("2026-10-21", {
          state: "pending_review",
          submittedChoice: null,
          finalStatus: "absent",
        }),
      ],
      "2026-10-21",
      "2026-10-22",
    );
    expect(week.map((d) => [d.label, d.status, d.current])).toEqual([
      ["Mon 19", "Present", false],
      ["Tue 20", "Leave", false],
      ["Wed 21", "Absent (proposed)", true],
      ["Thu 22", "No record", false],
    ]);
    // The proposed absence is undecided (amber, B13); a missing day is neutral.
    expect(week[2]?.dot).toEqual({ status: "absent", undecided: true });
    expect(week[3]?.dot).toEqual({ status: "none", undecided: false });
  });

  it("leaves out the days after today", () => {
    expect(reviewWeek([], "2026-10-19", "2026-10-19").map((d) => d.date)).toEqual(["2026-10-19"]);
  });

  it("says a waiting choice is waiting", () => {
    expect(
      contextStatus(day("2026-10-19", { state: "pending_review", submittedChoice: "half_day" })),
    ).toBe("Half day · waiting");
    expect(contextStatus(undefined)).toBe("No record");
  });
});
