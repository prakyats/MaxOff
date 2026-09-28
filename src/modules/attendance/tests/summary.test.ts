import { describe, expect, it } from "vitest";

import { dayFigure, type MonthSummary, pendingText, summaryLines } from "../domain/summary";

const SUMMARY: MonthSummary = {
  memberId: "m",
  fullName: "Asha",
  role: "staff",
  workingDays: 24,
  daysWorked: 18.5,
  presentDays: 18,
  leaveDays: 2,
  halfDays: 1,
  absentDays: 1,
  compLeaveDays: 1.5,
  additionalLeave: 3.5,
  daysOffWorked: 1,
  pendingDays: 2,
  overtimeNotes: 3,
  overtimeGranted: 1,
  creditsGranted: 2.5,
  creditsUsed: 1.5,
  creditsExpired: 0.5,
};

describe("dayFigure", () => {
  it("writes halves as ½, never as decimals", () => {
    expect(dayFigure(0)).toBe("0");
    expect(dayFigure(0.5)).toBe("½");
    expect(dayFigure(4)).toBe("4");
    expect(dayFigure(18.5)).toBe("18½");
  });
});

describe("summaryLines (PRODUCT §4.18, in its order)", () => {
  const lines = summaryLines(SUMMARY);

  it("lists the table's lines in order", () => {
    expect(lines.map((line) => line.label)).toEqual([
      "Working days",
      "Days worked",
      "Leave · Half days · Absent",
      "Comp leave used",
      "Additional leave",
      "Days off worked",
      "Overtime notes",
      "Comp leave credits",
    ]);
  });

  it("marks additional leave as the one that can reduce pay, with its formula", () => {
    const additional = lines.find((line) => line.key === "additional");
    expect(additional?.emphasis).toBe(true);
    expect(additional?.value).toBe("3½");
    expect(additional?.detail).toContain("Comp leave never counts");
    expect(lines.filter((line) => line.emphasis)).toHaveLength(1);
  });

  it("reads each figure", () => {
    const value = (key: string) => lines.find((line) => line.key === key)?.value;
    expect(value("working")).toBe("24");
    expect(value("worked")).toBe("18½");
    expect(value("leave")).toBe("2 · 1 · 1");
    expect(value("comp")).toBe("1½");
    expect(value("off")).toBe("1");
    expect(value("overtime")).toBe("3");
    expect(value("credits")).toBe("2½ · 1½ · ½");
  });
});

describe("pendingText", () => {
  it("names the days waiting, and nothing when none wait", () => {
    expect(pendingText(0)).toBeNull();
    expect(pendingText(1)).toBe("1 day waiting for your review");
    expect(pendingText(3)).toBe("3 days waiting for your review");
  });
});
