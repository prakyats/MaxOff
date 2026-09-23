import { describe, expect, it } from "vitest";

import { isWeekdayIndex, isWorkingDay, istWeekday, WEEKDAY_NAMES } from "./working-day";

describe("istWeekday", () => {
  it("reads the weekday of a business date", () => {
    expect(istWeekday("2026-09-20")).toBe(0); // Sunday
    expect(istWeekday("2026-09-21")).toBe(1);
    expect(istWeekday("2026-09-26")).toBe(6); // Saturday
  });

  it("names every weekday", () => {
    expect(WEEKDAY_NAMES[istWeekday("2026-09-20")].long).toBe("Sunday");
    expect(WEEKDAY_NAMES[istWeekday("2026-09-23")].short).toBe("Wed");
  });

  it("refuses anything that is not a calendar date", () => {
    expect(() => istWeekday("2026-02-30")).toThrow(RangeError);
    expect(() => istWeekday("20-09-2026")).toThrow(RangeError);
    expect(() => istWeekday("2026-09-21T10:00:00Z")).toThrow(RangeError);
  });
});

describe("isWeekdayIndex", () => {
  it("accepts 0..6 and nothing else", () => {
    expect([0, 3, 6].every(isWeekdayIndex)).toBe(true);
    expect([-1, 7, 1.5, Number.NaN].some(isWeekdayIndex)).toBe(false);
  });
});

describe("isWorkingDay", () => {
  const sundayOff = { weeklyOffDays: [0] };

  it("is true on an ordinary day", () => {
    expect(isWorkingDay("2026-09-21", sundayOff)).toBe(true);
  });

  it("is false on a weekly off day", () => {
    expect(isWorkingDay("2026-09-20", sundayOff)).toBe(false);
  });

  it("follows the company's own off days", () => {
    expect(isWorkingDay("2026-09-26", sundayOff)).toBe(true);
    expect(isWorkingDay("2026-09-26", { weeklyOffDays: [0, 6] })).toBe(false);
  });

  it("is false on a holiday", () => {
    const rules = { ...sundayOff, holidays: ["2026-10-02", "2026-12-25"] };
    expect(isWorkingDay("2026-10-02", rules)).toBe(false);
    expect(isWorkingDay("2026-10-01", rules)).toBe(true);
  });

  it("takes the holidays as a Set", () => {
    const rules = { ...sundayOff, holidays: new Set(["2026-10-02"]) };
    expect(isWorkingDay("2026-10-02", rules)).toBe(false);
  });

  it("treats a company with no off days as always working", () => {
    expect(isWorkingDay("2026-09-20", { weeklyOffDays: [] })).toBe(true);
  });
});
