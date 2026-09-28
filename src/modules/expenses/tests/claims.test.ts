import { describe, expect, it } from "vitest";

import {
  claimActions,
  claimOutcome,
  claimWindow,
  formatRupees,
  inClaimWindow,
  parseAmount,
  receiptRequired,
  unpaidTotal,
} from "../domain/claims";
import { markPaidSchema, receiptAboveSchema, submitClaimSchema } from "../domain/schemas";

describe("claimWindow (decision 24, the mirror of app.expense_window_start)", () => {
  it("is this month up to today after the 5th", () => {
    expect(claimWindow("2026-10-06")).toEqual({ from: "2026-10-01", to: "2026-10-06" });
    expect(claimWindow("2026-09-30")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("reaches back to the 1st of last month through the 5th", () => {
    expect(claimWindow("2026-10-05")).toEqual({ from: "2026-09-01", to: "2026-10-05" });
    expect(claimWindow("2026-10-01")).toEqual({ from: "2026-09-01", to: "2026-10-01" });
  });

  it("crosses the year in January", () => {
    expect(claimWindow("2026-01-03")).toEqual({ from: "2025-12-01", to: "2026-01-03" });
  });

  it("never takes a future date", () => {
    expect(inClaimWindow("2026-10-07", "2026-10-06")).toBe(false);
    expect(inClaimWindow("2026-10-06", "2026-10-06")).toBe(true);
    expect(inClaimWindow("2026-09-30", "2026-10-06")).toBe(false);
    expect(inClaimWindow("2026-09-30", "2026-10-05")).toBe(true);
  });
});

describe("receiptRequired (decision 23)", () => {
  it("is strictly above the Owner's amount", () => {
    expect(receiptRequired(500, 500)).toBe(false);
    expect(receiptRequired(500.01, 500)).toBe(true);
    expect(receiptRequired(1, 0)).toBe(true);
  });
});

describe("parseAmount", () => {
  it("reads rupees with commas, a ₹ sign and up to two decimals", () => {
    expect(parseAmount("250")).toBe(250);
    expect(parseAmount(" 1,200.50 ")).toBe(1200.5);
    expect(parseAmount("₹ 42.5")).toBe(42.5);
  });

  it("refuses what is not an amount above zero", () => {
    for (const text of ["", "0", "0.00", "-5", "10.005", "abc", "1e3", "10.", "99999999999"]) {
      expect(parseAmount(text)).toBeNull();
    }
  });
});

describe("formatRupees", () => {
  it("keeps whole rupees whole and shows paise with two digits, Indian grouping", () => {
    expect(formatRupees(1200)).toBe("₹1,200");
    expect(formatRupees(42.5)).toBe("₹42.50");
    expect(formatRupees(150000)).toBe("₹1,50,000");
  });
});

describe("claimOutcome and claimActions (WORKFLOWS §2a)", () => {
  it("says where each state stands, in the claimant's words", () => {
    const base = { decisionReason: null, paidOn: null };
    expect(claimOutcome({ ...base, state: "submitted" }).text).toBe("Waiting for the Owner");
    expect(claimOutcome({ ...base, state: "approved" }).text).toBe("Approved · not paid yet");
    expect(claimOutcome({ ...base, state: "paid", paidOn: "2026-10-03" }).text).toBe(
      "Paid on 3 Oct 2026",
    );
    expect(claimOutcome({ ...base, state: "rejected", decisionReason: "No" }).text).toBe(
      "Rejected",
    );
    expect(claimOutcome({ ...base, state: "withdrawn" }).status).toBe("withdrawn");
    expect(claimOutcome({ ...base, state: "paid" }).status).toBe("completed");
  });

  it("offers Withdraw only while the claim waits, as expense_claim_withdraw allows", () => {
    expect(claimActions({ state: "submitted" }).withdraw).toBe(true);
    for (const state of ["approved", "rejected", "withdrawn", "paid"] as const) {
      expect(claimActions({ state }).withdraw).toBe(false);
    }
  });
});

describe("unpaidTotal (the month summary's expense line)", () => {
  it("adds only approved claims, in paise", () => {
    expect(
      unpaidTotal([
        { state: "approved", amount: 0.1 },
        { state: "approved", amount: 0.2 },
        { state: "paid", amount: 100 },
        { state: "submitted", amount: 50 },
        { state: "rejected", amount: 9 },
      ]),
    ).toEqual({ total: 0.3, count: 2 });
    expect(unpaidTotal([])).toEqual({ total: 0, count: 0 });
  });
});

describe("the schemas", () => {
  const valid = {
    expenseDate: "2026-10-01",
    amount: 120.5,
    categoryId: "00000000-0000-4000-8000-000000000001",
    note: "Auto",
  };

  it("take a claim and default the receipt to none", () => {
    expect(submitClaimSchema.parse(valid).receiptFileId).toBeNull();
  });

  it("take every amount in rupees and paise, floating point notwithstanding (3bB review)", () => {
    for (const amount of [1.1, 4.35, 150.1, 0.07, 999.99, 1200.5, 0.01]) {
      expect(submitClaimSchema.safeParse({ ...valid, amount }).success, String(amount)).toBe(true);
    }
    for (let paise = 1; paise < 100000; paise += 1) {
      if (!submitClaimSchema.safeParse({ ...valid, amount: paise / 100 }).success) {
        throw new Error(`refused ${paise / 100}`);
      }
    }
  });

  it("refuse three decimals, zero and an empty note", () => {
    expect(submitClaimSchema.safeParse({ ...valid, amount: 1.005 }).success).toBe(false);
    expect(submitClaimSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
    expect(submitClaimSchema.safeParse({ ...valid, note: "  " }).success).toBe(false);
  });

  it("mark paid needs at least one claim; the date is optional", () => {
    expect(markPaidSchema.safeParse({ claimIds: [] }).success).toBe(false);
    expect(markPaidSchema.parse({ claimIds: [valid.categoryId] }).paidOn).toBeNull();
  });

  it("the receipt amount may be zero, never negative", () => {
    expect(receiptAboveSchema.safeParse({ receiptAbove: 0 }).success).toBe(true);
    expect(receiptAboveSchema.safeParse({ receiptAbove: -1 }).success).toBe(false);
  });
});
