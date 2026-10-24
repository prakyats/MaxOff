import { describe, expect, it } from "vitest";

import { monthStrip, type StripPerson } from "./month-strip";

const person = (over: Partial<StripPerson> = {}): StripPerson => ({
  workingDays: 15,
  daysWorked: 12,
  leaveDays: 0,
  absentDays: 0,
  pendingDays: 0,
  overtimeNotes: 0,
  overtimeGranted: 0,
  ...over,
});

describe("monthStrip (PP-reports-1)", () => {
  it("adds the team up into tiles, each tappable", () => {
    const strip = monthStrip(
      [
        person({ leaveDays: 1, pendingDays: 2 }),
        person({ daysWorked: 10.5, absentDays: 1, overtimeNotes: 1, overtimeGranted: 1 }),
      ],
      { paise: 25000, count: 1, words: "₹250" },
    );
    expect(strip.tiles.map((tile) => [tile.key, tile.figure, tile.detail])).toEqual([
      ["worked", "22½ / 30", "1 leave · 1 absent"],
      ["waiting", "2", "Review in Approvals"],
      ["overtime", "1", "1 earned comp leave"],
      ["expenses", "₹250", "1 claim approved"],
    ]);
    expect(strip.tiles.find((tile) => tile.key === "waiting")?.href).toBe("/approvals");
    expect(strip.quiet).toBeNull();
  });
  it("folds the metrics with nothing in them into one muted line", () => {
    const strip = monthStrip([person()], { paise: 0, count: 0, words: "₹0" });
    expect(strip.tiles.map((tile) => tile.key)).toEqual(["worked"]);
    expect(strip.quiet).toBe("So far: no days waiting, no overtime notes and no expenses to pay.");
  });
  it("leaves money out without the key (unpaid null)", () => {
    const strip = monthStrip([person()], null);
    expect(strip.quiet).toBe("So far: no days waiting and no overtime notes.");
  });
});
