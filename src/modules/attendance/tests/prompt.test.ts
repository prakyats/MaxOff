import { describe, expect, it } from "vitest";

import { parseShownAt, PROMPT_SNOOZE_MS, promptDueNow, promptSnoozeKey } from "../domain/prompt";

describe("the Start-day prompt's snooze (kickoff 3b decision 3)", () => {
  const now = Date.UTC(2026, 8, 23, 4, 0, 0);

  it("asks at most once every 30 minutes", () => {
    expect(PROMPT_SNOOZE_MS).toBe(30 * 60 * 1000);
    expect(promptDueNow(null, now)).toBe(true);
    expect(promptDueNow(now - 1, now)).toBe(false);
    expect(promptDueNow(now - PROMPT_SNOOZE_MS + 1, now)).toBe(false);
    expect(promptDueNow(now - PROMPT_SNOOZE_MS, now)).toBe(true);
  });

  it("treats anything unreadable as never asked", () => {
    expect(parseShownAt(null)).toBeNull();
    expect(parseShownAt("not a number")).toBeNull();
    expect(parseShownAt(String(now))).toBe(now);
    expect(promptDueNow(Number.NaN, now)).toBe(true);
  });

  it("keys the snooze by member and IST date, so a new day asks again", () => {
    const key = promptSnoozeKey("m1", "2026-09-23");
    expect(key).toContain("m1");
    expect(key).toContain("2026-09-23");
    expect(key).not.toBe(promptSnoozeKey("m1", "2026-09-24"));
    expect(key).not.toBe(promptSnoozeKey("m2", "2026-09-23"));
  });
});
