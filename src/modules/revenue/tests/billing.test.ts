import { describe, expect, it } from "vitest";

import { addISTDays, todayIST } from "@/core/time";

import {
  addedHeading,
  advanceSummary,
  amountLabel,
  amountSheetNote,
  amountText,
  isBillingCategory,
  longDay,
  monthName,
  priceText,
  shortDay,
  toProjectBilling,
} from "../domain/billing";
import { parseWholeRupees } from "../domain/money";
import {
  recordAdvanceSchema,
  returnAdvanceSchema,
  setAmountSchema,
  setCategorySchema,
  setPriceSchema,
} from "../domain/schemas";

const ID = "7f3b6d0e-1c2a-4b5d-8e9f-0a1b2c3d4e5f";
const OTHER = "0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a";

describe("parseWholeRupees: whole rupees in", () => {
  it("reads digits, comma grouping and a typed ₹", () => {
    expect(parseWholeRupees("40000")).toEqual({ ok: true, value: 40000 });
    expect(parseWholeRupees(" 1,20,000 ")).toEqual({ ok: true, value: 120000 });
    expect(parseWholeRupees("₹ 60,000")).toEqual({ ok: true, value: 60000 });
    expect(parseWholeRupees("500.00")).toEqual({ ok: true, value: 500 });
  });
  it("takes ₹0 as an amount (Not billable), except where it must be above zero", () => {
    expect(parseWholeRupees("0")).toEqual({ ok: true, value: 0 });
    expect(parseWholeRupees("0", { positive: true })).toEqual({
      ok: false,
      message: "Enter an amount above ₹0.",
    });
  });
  it("refuses paise, a negative, an empty field and words, each in its own words", () => {
    expect(parseWholeRupees("40000.50")).toEqual({
      ok: false,
      message: "Whole rupees only, no paise.",
    });
    expect(parseWholeRupees("0.5")).toEqual({ ok: false, message: "Whole rupees only, no paise." });
    expect(parseWholeRupees("-500")).toEqual({
      ok: false,
      message: "The amount can't be less than ₹0.",
    });
    expect(parseWholeRupees("  ")).toEqual({ ok: false, message: "Enter the amount in rupees." });
    expect(parseWholeRupees("forty")).toEqual({
      ok: false,
      message: "Enter the amount in rupees, e.g. 40000.",
    });
    expect(parseWholeRupees("4e4").ok).toBe(false);
    expect(parseWholeRupees("10000000000")).toEqual({
      ok: false,
      message: "That amount is too large.",
    });
  });
});

describe("toProjectBilling: the read's JSON as the section's shape", () => {
  it("maps a retainer with its cycle and added deliverables", () => {
    const billing = toProjectBilling({
      project_id: ID,
      recurrence: "monthly",
      billing: {
        category: "retainer",
        category_is_default: true,
        cycle_amount: 40000,
        fixed_amount: null,
        priced_from: "2026-11-01",
      },
      cycle: {
        cycle_id: OTHER,
        label: "November 2026",
        month: "2026-11-01",
        amount: 40000,
        potential: 45000,
        achieved: 10000,
        remaining: 35000,
        closed_not_achieved: 0,
        added_value: 5000,
        added_count: 3,
        not_priced_count: 1,
        plan_count: 4,
      },
      added: [
        { item_id: ID, title: "Extra reel", method: "added", value: 5000, achieved: false },
        { item_id: OTHER, title: "Poster", method: "not_priced", value: 0, achieved: false },
        { item_id: ID, title: "Favour", method: "added", value: 0, achieved: true },
      ],
    });
    expect(billing).toEqual({
      kind: "retainer",
      projectId: ID,
      recurrence: "monthly",
      billing: {
        category: "retainer",
        categoryIsDefault: true,
        cycleAmount: 40000,
        fixedAmount: null,
        pricedFrom: "2026-11-01",
      },
      cycle: {
        cycleId: OTHER,
        label: "November 2026",
        amount: 40000,
        potential: 45000,
        achieved: 10000,
        remaining: 35000,
      },
      added: [
        { itemId: ID, title: "Extra reel", price: 5000 },
        // "Not priced" is no price at all, never ₹0 (which is "Not billable").
        { itemId: OTHER, title: "Poster", price: null },
        { itemId: ID, title: "Favour", price: 0 },
      ],
    });
  });

  it("maps a retainer with nothing set and no cycle in view", () => {
    const billing = toProjectBilling({
      project_id: ID,
      recurrence: "weekly",
      billing: {
        category: "retainer",
        category_is_default: true,
        cycle_amount: null,
        fixed_amount: null,
        priced_from: null,
      },
      cycle: null,
      added: [],
    });
    expect(billing).toMatchObject({
      kind: "retainer",
      recurrence: "weekly",
      cycle: null,
      added: [],
    });
    expect(billing.billing.cycleAmount).toBeNull();
    expect(billing.billing.pricedFrom).toBeNull();
  });

  it("maps a one-time project with its dates and advances", () => {
    const billing = toProjectBilling({
      project_id: ID,
      recurrence: "one_time",
      billing: {
        category: "additional_work",
        category_is_default: false,
        cycle_amount: null,
        fixed_amount: "60000.00",
        priced_from: "2026-11-01",
      },
      line: {
        month: "2026-11-01",
        amount: 60000,
        potential: 60000,
        achieved: 0,
        closed_not_achieved: 0,
        was_due: true,
        ready_to_complete: true,
        state: "in_progress",
        delivery_date: "2026-11-15",
        advances_kept: 30000,
        advances_returned: 10000,
      },
      advances: [
        {
          id: ID,
          amount: 30000,
          received_on: "2026-11-02",
          note: "On signing",
          returned_on: null,
          return_note: null,
        },
        {
          id: OTHER,
          amount: 10000,
          received_on: "2026-11-03",
          note: null,
          returned_on: "2026-11-10",
          return_note: "Paid twice",
        },
      ],
    });
    expect(billing).toEqual({
      kind: "one_time",
      projectId: ID,
      recurrence: "one_time",
      billing: {
        category: "additional_work",
        categoryIsDefault: false,
        cycleAmount: null,
        fixedAmount: 60000,
        pricedFrom: "2026-11-01",
      },
      wasDue: "2026-11-15",
      readyToComplete: true,
      advancesKept: 30000,
      advances: [
        {
          id: ID,
          amount: 30000,
          receivedOn: "2026-11-02",
          note: "On signing",
          returnedOn: null,
          returnNote: null,
        },
        {
          id: OTHER,
          amount: 10000,
          receivedOn: "2026-11-03",
          note: null,
          returnedOn: "2026-11-10",
          returnNote: "Paid twice",
        },
      ],
    });
  });

  it("says no due date unless the project is past it, and defaults a missing line", () => {
    const base = {
      project_id: ID,
      recurrence: "one_time",
      billing: {
        category: "project",
        category_is_default: true,
        cycle_amount: null,
        fixed_amount: null,
        priced_from: null,
      },
      advances: [],
    };
    const onTime = toProjectBilling({
      ...base,
      line: { was_due: false, ready_to_complete: false, delivery_date: "2026-12-01" },
    });
    expect(onTime).toMatchObject({ wasDue: null, readyToComplete: false, advancesKept: 0 });
    expect(toProjectBilling({ ...base, line: null })).toMatchObject({ wasDue: null, advances: [] });
  });

  it("refuses an answer that is not the read's", () => {
    expect(() => toProjectBilling(null)).toThrow();
    expect(() => toProjectBilling({ project_id: ID, recurrence: "yearly", billing: {} })).toThrow();
    expect(() => toProjectBilling({ project_id: ID, recurrence: "monthly" })).toThrow();
  });
});

describe("the section's words", () => {
  it("labels the amount by the repeat", () => {
    expect(amountLabel("monthly")).toBe("Amount per month");
    expect(amountLabel("weekly")).toBe("Amount per week");
    expect(amountLabel("one_time")).toBe("Amount");
    expect(addedHeading("monthly")).toBe("Added this month");
    expect(addedHeading("weekly")).toBe("Added this week");
  });
  it("reads no amount, ₹0 and an amount apart", () => {
    expect(amountText(null)).toBe("No amount set");
    expect(amountText(0)).toBe("Not billable");
    expect(amountText(40000)).toBe("₹40,000");
    expect(priceText(null)).toBe("Not priced");
    expect(priceText(0)).toBe("Not billable");
    expect(priceText(5000)).toBe("₹5,000");
  });
  it("says which cycles a first amount and a later change cover", () => {
    expect(amountSheetNote("monthly", null, "2026-11-18")).toBe(
      'From November 2026 on. Earlier months stay "No amount set".',
    );
    expect(amountSheetNote("weekly", null, "2026-11-18")).toBe(
      'From November 2026 on. Earlier weeks stay "No amount set".',
    );
    expect(amountSheetNote("monthly", "2026-10-01", "2026-11-18")).toBe(
      "Applies from this month on. Earlier ones keep their amount.",
    );
    expect(amountSheetNote("weekly", "2026-10-01", "2026-11-18")).toBe(
      "Applies from this week on. Earlier ones keep their amount.",
    );
    expect(amountSheetNote("one_time", null, "2026-11-18")).toBe(
      "One amount for the whole project.",
    );
  });
  it("names days and months in IST", () => {
    expect(monthName("2026-11-30")).toBe("November 2026");
    expect(monthName("2027-01-01")).toBe("January 2027");
    expect(shortDay("2026-11-15")).toBe("15 Nov");
    expect(longDay("2026-12-03")).toBe("3 Dec 2026");
  });
  it("sums up the advances against the amount", () => {
    expect(advanceSummary(60000, 30000)).toBe(
      "Advance received ₹30,000 · Balance on delivery ₹30,000",
    );
    expect(advanceSummary(60000, 60000)).toBe("Advance received ₹60,000 · Balance on delivery ₹0");
    expect(advanceSummary(60000, 0)).toBeNull();
    expect(advanceSummary(null, 30000)).toBe("Advance received ₹30,000");
  });
  it("knows the three categories", () => {
    expect(isBillingCategory("additional_work")).toBe(true);
    expect(isBillingCategory("extras")).toBe(false);
    expect(isBillingCategory(null)).toBe(false);
  });
});

describe("the actions' schemas", () => {
  const today = todayIST();
  it("takes whole rupees, zero included, for an amount and a price", () => {
    expect(setAmountSchema.parse({ projectId: ID, amount: 40000 }).amount).toBe(40000);
    expect(setAmountSchema.safeParse({ projectId: ID, amount: 0 }).success).toBe(true);
    expect(setPriceSchema.safeParse({ itemId: ID, price: 5000 }).success).toBe(true);
    expect(setPriceSchema.safeParse({ itemId: ID, price: 0 }).success).toBe(true);
  });
  it("refuses paise, a negative, a missing amount and one too large to store", () => {
    for (const amount of [40000.5, -1, Number.NaN, 10_000_000_000]) {
      expect(setAmountSchema.safeParse({ projectId: ID, amount }).success, String(amount)).toBe(
        false,
      );
      expect(setPriceSchema.safeParse({ itemId: ID, price: amount }).success).toBe(false);
    }
    expect(setAmountSchema.safeParse({ projectId: ID }).success).toBe(false);
    expect(setAmountSchema.safeParse({ projectId: "nope", amount: 1 }).success).toBe(false);
    const paise = setAmountSchema.safeParse({ projectId: ID, amount: 10.5 });
    expect(paise.error?.issues[0]?.message).toBe("Whole rupees only, no paise.");
  });
  it("takes only the three categories", () => {
    expect(setCategorySchema.safeParse({ projectId: ID, category: "project" }).success).toBe(true);
    expect(setCategorySchema.safeParse({ projectId: ID, category: "extras" }).success).toBe(false);
  });
  it("records an advance above ₹0, dated up to today, with an optional note", () => {
    const parsed = recordAdvanceSchema.parse({
      projectId: ID,
      amount: 30000,
      receivedOn: today,
      note: "  On signing  ",
    });
    expect(parsed.note).toBe("On signing");
    expect(
      recordAdvanceSchema.parse({ projectId: ID, amount: 1, receivedOn: today, note: "  " }).note,
    ).toBeNull();
    expect(
      recordAdvanceSchema.parse({ projectId: ID, amount: 1, receivedOn: today }).note,
    ).toBeNull();
    const base = { projectId: ID, receivedOn: today };
    expect(recordAdvanceSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(recordAdvanceSchema.safeParse({ ...base, amount: 100.25 }).success).toBe(false);
    expect(
      recordAdvanceSchema.safeParse({ projectId: ID, amount: 1, receivedOn: addISTDays(today, 1) })
        .success,
    ).toBe(false);
    expect(
      recordAdvanceSchema.safeParse({ projectId: ID, amount: 1, receivedOn: "18-11-2026" }).success,
    ).toBe(false);
    expect(
      recordAdvanceSchema.safeParse({ ...base, amount: 1, note: "x".repeat(501) }).success,
    ).toBe(false);
  });
  it("marks an advance returned on a day up to today", () => {
    expect(returnAdvanceSchema.parse({ advanceId: ID, returnedOn: today }).note).toBeNull();
    expect(
      returnAdvanceSchema.safeParse({ advanceId: ID, returnedOn: addISTDays(today, 1) }).success,
    ).toBe(false);
    expect(returnAdvanceSchema.safeParse({ advanceId: "x", returnedOn: today }).success).toBe(
      false,
    );
  });
});
