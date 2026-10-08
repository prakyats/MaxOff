import { describe, expect, it } from "vitest";

import {
  describeReminder,
  describeReminders,
  draftFromRules,
  LAUNCH_REMINDERS,
  nextReminderRow,
  isReminderRuleList,
  parseReminderRules,
  reminderRowErrors,
  reminderUnitLabel,
  resolveReminders,
  rowsFromRules,
  rulesFromDraft,
  sameReminders,
} from "./reminder-rules";
import { reminderRulesSchema } from "./reminder-rules-schema";

/**
 * The list schema mirrors `app.reminder_rules_valid` (migration task_reminders) rule for rule,
 * and the browser's zod-free check (`isReminderRuleList`) says the same of every value.
 */
describe("reminderRulesSchema and isReminderRuleList", () => {
  const ok = (value: unknown) => {
    const valid = reminderRulesSchema.safeParse(value).success;
    expect(isReminderRuleList(value), JSON.stringify(value)).toBe(valid);
    return valid;
  };

  it("takes up to 5 distinct whole-number rules, 0 to 60 days before", () => {
    expect(ok([])).toBe(true);
    expect(ok([...LAUNCH_REMINDERS])).toBe(true);
    expect(
      ok([
        { before: 60, unit: "days" },
        { before: 1440, unit: "hours" },
        { before: 86399, unit: "minutes" },
        { before: 0, unit: "minutes" },
        { before: 0.0, unit: "hours" },
      ]),
    ).toBe(false); // 0 minutes and 0 hours are the same time
    expect(
      ok([
        { before: 60, unit: "days" },
        { before: 1439, unit: "hours" },
        { before: 86399, unit: "minutes" },
        { before: 0, unit: "minutes" },
        { before: 5, unit: "minutes" },
      ]),
    ).toBe(true);
  });

  it("refuses more than 5, a fraction, a negative, a string, an unknown unit or key", () => {
    const six = [1, 2, 3, 4, 5, 6].map((before) => ({ before, unit: "hours" }));
    expect(ok(six)).toBe(false);
    expect(ok([{ before: 1.5, unit: "hours" }])).toBe(false);
    expect(ok([{ before: -1, unit: "hours" }])).toBe(false);
    expect(ok([{ before: "2", unit: "days" }])).toBe(false);
    expect(ok([{ before: 2, unit: "weeks" }])).toBe(false);
    expect(ok([{ before: 2, unit: "days", channel: "email" }])).toBe(false);
    expect(ok([{ offset: 60 }])).toBe(false);
    expect(ok({ before: 2, unit: "days" })).toBe(false);
    expect(ok(null)).toBe(false);
  });

  it("refuses more than 60 days in any unit", () => {
    expect(ok([{ before: 60, unit: "days" }])).toBe(true);
    expect(ok([{ before: 61, unit: "days" }])).toBe(false);
    expect(ok([{ before: 1441, unit: "hours" }])).toBe(false);
    expect(ok([{ before: 86401, unit: "minutes" }])).toBe(false);
  });

  it("names the second of two rules at the same time (1 day and 24 hours)", () => {
    const result = reminderRulesSchema.safeParse([
      { before: 1, unit: "days" },
      { before: 24, unit: "hours" },
    ]);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: [1, "before"],
        message: "Another reminder is already at this time.",
      }),
    ]);
  });
});

describe("describeReminders", () => {
  it("reads the launch schedule as the owner wrote it", () => {
    expect(describeReminders(LAUNCH_REMINDERS)).toBe("2 days before, 1 day before, when due");
  });

  it("says singular and plural, and 0 as when due, in any unit", () => {
    expect(describeReminder({ before: 1, unit: "hours" })).toBe("1 hour before");
    expect(describeReminder({ before: 3, unit: "hours" })).toBe("3 hours before");
    expect(describeReminder({ before: 1, unit: "minutes" })).toBe("1 minute before");
    expect(describeReminder({ before: 30, unit: "minutes" })).toBe("30 minutes before");
    expect(describeReminder({ before: 1, unit: "days" })).toBe("1 day before");
    expect(describeReminder({ before: 0, unit: "hours" })).toBe("when due");
  });

  it("lists the earliest first, whatever order they were typed in", () => {
    expect(
      describeReminders([
        { before: 0, unit: "minutes" },
        { before: 1, unit: "hours" },
        { before: 2, unit: "days" },
      ]),
    ).toBe("2 days before, 1 hour before, when due");
  });
});

describe("resolveReminders", () => {
  const mine = [{ before: 3, unit: "hours" }] as const;
  const theirs = [{ before: 5, unit: "days" }] as const;

  it("takes the first level with rules of its own: each replaces the ones below, no merge", () => {
    expect(resolveReminders([mine, theirs])).toEqual(mine);
    expect(resolveReminders([[], theirs])).toEqual(theirs);
    expect(resolveReminders([null, undefined, theirs])).toEqual(theirs);
  });

  it("falls back to the launch schedule when every level is empty", () => {
    expect(resolveReminders([])).toEqual(LAUNCH_REMINDERS);
    expect(resolveReminders([[], null, []])).toEqual(LAUNCH_REMINDERS);
  });
});

describe("parseReminderRules", () => {
  it("reads a stored list, and anything invalid as the next level ([])", () => {
    expect(parseReminderRules([{ before: 2, unit: "days" }])).toEqual([
      { before: 2, unit: "days" },
    ]);
    expect(parseReminderRules([])).toEqual([]);
    expect(parseReminderRules([{ offset: 60 }])).toEqual([]);
    expect(parseReminderRules(null)).toEqual([]);
  });
});

describe("the editor's draft", () => {
  it("starts as 'using the default' (null) for an empty list, else as rows", () => {
    expect(draftFromRules([])).toBeNull();
    expect(draftFromRules([{ before: 2, unit: "days" }])).toEqual([{ before: "2", unit: "days" }]);
  });

  it("saves [] for the default or no rows, the rules when every row is fine", () => {
    expect(rulesFromDraft(null)).toEqual([]);
    expect(rulesFromDraft([])).toEqual([]);
    expect(rulesFromDraft([{ before: " 4 ", unit: "hours" }])).toEqual([
      { before: 4, unit: "hours" },
    ]);
    expect(rulesFromDraft(rowsFromRules(LAUNCH_REMINDERS))).toEqual(LAUNCH_REMINDERS);
  });

  it("saves nothing (null) while a row needs fixing, or with more than 5 rows", () => {
    expect(rulesFromDraft([{ before: "", unit: "hours" }])).toBeNull();
    const six = [1, 2, 3, 4, 5, 6].map((n) => ({ before: String(n), unit: "hours" as const }));
    expect(rulesFromDraft(six)).toBeNull();
  });

  it("gives each row its own message: whole number, 60 days, the same time twice", () => {
    expect(
      reminderRowErrors([
        { before: "2", unit: "days" },
        { before: "1.5", unit: "hours" },
        { before: "61", unit: "days" },
        { before: "48", unit: "hours" },
        { before: "abc", unit: "minutes" },
        { before: "-1", unit: "minutes" },
        { before: "", unit: "minutes" },
      ]),
    ).toEqual([
      null,
      "Use a whole number, like 2.",
      "Up to 60 days before the deadline.",
      "Another reminder is already at this time.",
      "Use a whole number, like 2.",
      "Use a whole number, like 2.",
      "Use a whole number, like 2.",
    ]);
  });

  it("adds a row at a time no other row has, so a new row needs no fixing", () => {
    expect(nextReminderRow([])).toEqual({ before: "1", unit: "days" });
    expect(nextReminderRow(rowsFromRules(LAUNCH_REMINDERS))).toEqual({
      before: "1",
      unit: "hours",
    });
    let rows = rowsFromRules(LAUNCH_REMINDERS);
    while (rows.length < 5) rows = [...rows, nextReminderRow(rows)];
    expect(reminderRowErrors(rows).every((message) => message === null)).toBe(true);
  });

  it("names the unit after the number: 1 day, 2 days", () => {
    expect(reminderUnitLabel("days", "1")).toBe("day");
    expect(reminderUnitLabel("days", "2")).toBe("days");
    expect(reminderUnitLabel("hours", "")).toBe("hours");
  });

  it("compares two lists rule for rule", () => {
    expect(sameReminders([], [])).toBe(true);
    expect(sameReminders(LAUNCH_REMINDERS, [...LAUNCH_REMINDERS])).toBe(true);
    expect(sameReminders(LAUNCH_REMINDERS, LAUNCH_REMINDERS.slice(1))).toBe(false);
    expect(sameReminders([{ before: 1, unit: "days" }], [{ before: 24, unit: "hours" }])).toBe(
      false,
    );
  });
});
