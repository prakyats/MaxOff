import { describe, expect, it } from "vitest";

import { MASKED_AMOUNT, type MonthTotals, todayRevenueLine, toMonthTotals } from "../domain/today";

const totals = (over: Partial<MonthTotals> = {}): MonthTotals => ({
  month: "2026-11-01",
  potential: 120000,
  achieved: 45000,
  remaining: 75000,
  notPriced: 0,
  noAmount: 0,
  ...over,
});

describe("todayRevenueLine: the Owner's line at the end of Today (R5)", () => {
  it("masks both amounts until tapped: the rupee sign and dots, never a digit", () => {
    const line = todayRevenueLine(totals(), { masked: true });
    expect(line).toBe(`November · ${MASKED_AMOUNT} achieved of ${MASKED_AMOUNT}`);
    expect(line).not.toMatch(/\d/);
  });

  it("shows the real figures once tapped", () => {
    expect(todayRevenueLine(totals(), { masked: false })).toBe(
      "November · ₹45,000 achieved of ₹1,20,000",
    );
  });

  it("adds what needs a look, each only above zero", () => {
    expect(todayRevenueLine(totals({ notPriced: 2 }), { masked: true })).toBe(
      "November · ₹ ••• achieved of ₹ ••• · 2 not priced",
    );
    expect(todayRevenueLine(totals({ notPriced: 2, noAmount: 1 }), { masked: false })).toBe(
      "November · ₹45,000 achieved of ₹1,20,000 · 2 not priced · 1 with no amount",
    );
    expect(todayRevenueLine(totals({ noAmount: 3 }), { masked: true })).toBe(
      "November · ₹ ••• achieved of ₹ ••• · 3 with no amount",
    );
  });

  it("names the month of the read, from any day of it", () => {
    expect(todayRevenueLine(totals({ month: "2027-01-15" }), { masked: true })).toMatch(
      /^January · /,
    );
  });
});

describe("toMonthTotals: the read's JSON", () => {
  it("maps the figures and the counts", () => {
    expect(
      toMonthTotals({
        month: "2026-11-01",
        potential: "120000.00",
        achieved: 45000,
        remaining: 75000,
        not_priced: 2,
        no_amount: 1,
      }),
    ).toEqual(totals({ notPriced: 2, noAmount: 1 }));
  });

  it("refuses an answer that is not the read's, without repeating an amount", () => {
    expect(() => toMonthTotals(null)).toThrow();
    expect(() => toMonthTotals({ potential: 1 })).toThrow();
    expect(() => toMonthTotals({ month: "2026-11-01", potential: "lots" })).toThrow(
      /^The month's totals hold an amount that is not one\.$/,
    );
  });
});
