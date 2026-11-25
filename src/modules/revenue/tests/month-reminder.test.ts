import { describe, expect, it } from "vitest";

import {
  monthReminderAction,
  monthReminderLine,
  monthReminderSchema,
} from "../domain/month-reminder";

describe("the month close reminder's words (v3.5 U6, WORKFLOWS §7.3)", () => {
  it("names one month", () => {
    expect(monthReminderLine({ month: "2026-09-01", more: 0 }, "2026-10-06")).toBe(
      "September isn't closed yet",
    );
    expect(monthReminderAction({ month: "2026-09-01", more: 0 }, "2026-10-06")).toBe(
      "Close September",
    );
  });

  it("counts the others, oldest named", () => {
    expect(monthReminderLine({ month: "2026-08-01", more: 1 }, "2026-10-06")).toBe(
      "August and 1 more month aren't closed yet",
    );
    expect(monthReminderLine({ month: "2026-07-01", more: 2 }, "2026-10-06")).toBe(
      "July and 2 more months aren't closed yet",
    );
    expect(monthReminderAction({ month: "2026-07-01", more: 2 }, "2026-10-06")).toBe("Close July");
  });

  it("names the year only when it is not today's", () => {
    expect(monthReminderLine({ month: "2026-12-01", more: 0 }, "2027-01-06")).toBe(
      "December 2026 isn't closed yet",
    );
    expect(monthReminderAction({ month: "2026-12-01", more: 0 }, "2027-01-06")).toBe(
      "Close December 2026",
    );
    expect(monthReminderLine({ month: "2026-01-01", more: 0 }, "2026-12-06")).toBe(
      "January isn't closed yet",
    );
  });

  it("holds no digit but the year and the count, never an amount", () => {
    for (const line of [
      monthReminderLine({ month: "2026-09-01", more: 0 }, "2026-10-06"),
      monthReminderLine({ month: "2025-09-01", more: 3 }, "2026-10-06"),
    ]) {
      expect(line).toMatch(
        /^[A-Z][a-z]+( \d{4})?( and \d+ more months?)? (isn't|aren't) closed yet$/,
      );
      expect(line).not.toMatch(/₹/);
    }
  });

  it("reads the database's answer: a month's first day and a count, or null", () => {
    expect(monthReminderSchema.parse({ month: "2026-09-01", more: 2 })).toEqual({
      month: "2026-09-01",
      more: 2,
    });
    expect(monthReminderSchema.parse(null)).toBeNull();
    expect(monthReminderSchema.safeParse({ month: "2026-09-15", more: 0 }).success).toBe(false);
    expect(monthReminderSchema.safeParse({ month: "2026-09-01", more: -1 }).success).toBe(false);
  });
});
