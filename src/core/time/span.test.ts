import { describe, expect, it } from "vitest";

import { lateWords, overdueWords, spanWords } from "./span";

const MIN = 60_000;
const H = 60 * MIN;

describe("spanWords (B10: one rule)", () => {
  it("says minutes under an hour, never 0", () => {
    expect(spanWords(0)).toBe("1 min");
    expect(spanWords(25 * MIN)).toBe("25 min");
  });

  it("says hours under a day, rounded", () => {
    expect(spanWords(H)).toBe("1 h");
    expect(spanWords(2 * H + 50 * MIN)).toBe("3 h");
    expect(spanWords(23 * H + 20 * MIN)).toBe("23 h");
  });

  it("says days from 24 hours, never hours", () => {
    expect(spanWords(23 * H + 40 * MIN)).toBe("1 day");
    expect(spanWords(24 * H)).toBe("1 day");
    expect(spanWords(33 * H)).toBe("1 day");
    expect(spanWords(47 * H)).toBe("2 days");
    expect(spanWords(100 * H)).toBe("4 days");
  });
});

describe("overdueWords", () => {
  it('says "overdue 1 day" past 24 hours, "overdue 3 h" before', () => {
    expect(overdueWords(33 * H)).toBe("overdue 1 day");
    expect(overdueWords(3 * H)).toBe("overdue 3 h");
  });
});

describe("lateWords (PP-tasks-2: every task row's late chip, as on Today)", () => {
  it('says "N h late" under a day and "N days late" after', () => {
    expect(lateWords(3 * H)).toBe("3 h late");
    expect(lateWords(2 * 24 * H)).toBe("2 days late");
    expect(lateWords(24 * H)).toBe("1 day late");
  });
});
