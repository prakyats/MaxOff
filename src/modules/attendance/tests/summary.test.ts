import { describe, expect, it } from "vitest";

import {
  dayFigure,
  type MonthSummary,
  pendingText,
  summaryLines,
  workedHalfDays,
} from "../domain/summary";

const SUMMARY: MonthSummary = {
  hours: null,
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
      "Leave",
      "Half days",
      "Absent",
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
    // W6: three labelled rows instead of "2 · 1 · 1".
    expect(value("leave")).toBe("2");
    expect(value("half")).toBe("1");
    expect(value("absent")).toBe("1");
    expect(value("comp")).toBe("1½");
    expect(value("off")).toBe("1");
    expect(value("overtime")).toBe("3");
    expect(value("credits")).toBe("2½");
    expect(lines.find((line) => line.key === "credits")?.detail).toBe(
      "2½ granted · 1½ used · ½ expired",
    );
  });
});

describe("a split day in the month (v2.0.1, WORKFLOWS §2b)", () => {
  // One decided day off made of a ½ comp morning and an ordinary afternoon, nothing else: what
  // `month_summary()` answers for it (½ comp, ½ additional leave, one of the half days, nothing
  // worked).
  const split: MonthSummary = {
    ...SUMMARY,
    daysWorked: 0,
    presentDays: 0,
    leaveDays: 0,
    halfDays: 1,
    absentDays: 0,
    compLeaveDays: 0.5,
    additionalLeave: 0.5,
    daysOffWorked: 0,
    pendingDays: 0,
  };
  const lines = summaryLines(split);
  const line = (key: string) => lines.find((entry) => entry.key === key);

  it("shows ½ comp leave and ½ additional leave, and the day among the half days", () => {
    expect(line("comp")?.value).toBe("½");
    expect(line("additional")?.value).toBe("½");
    expect(line("half")?.value).toBe("1");
    expect(line("leave")?.value).toBe("0");
  });

  it("names no half worked under Days worked: nothing of a split day is worked", () => {
    expect(line("worked")?.value).toBe("0");
    expect(line("worked")?.detail).toBe("0 present · 0 half days");
    expect(workedHalfDays(split)).toBe(0);
  });

  it("counts the half days that were half worked from the server's figures", () => {
    // 18 present and one half day worked: 18½.
    expect(workedHalfDays(SUMMARY)).toBe(1);
    expect(summaryLines(SUMMARY).find((entry) => entry.key === "worked")?.detail).toBe(
      "18 present · 1 half day",
    );
    // A ½ comp day worked its other half: it is in days worked, never in halfDays.
    expect(workedHalfDays({ daysWorked: 3.5, presentDays: 3 })).toBe(1);
  });
});

describe("pendingText", () => {
  it("names the days waiting, and nothing when none wait", () => {
    expect(pendingText(0)).toBeNull();
    expect(pendingText(1)).toBe("1 day waiting for your review");
    expect(pendingText(3)).toBe("3 days waiting for your review");
  });
});
