import { describe, expect, it } from "vitest";

import { addISTDays, todayIST } from "@/core/time";

import {
  addedHeading,
  adjustmentLines,
  advanceSummary,
  amountLabel,
  amountSheetNote,
  amountText,
  billedText,
  canAdjust,
  isBillingCategory,
  longDay,
  monthName,
  oneTimeStatusExpected,
  plannedHeading,
  plannedValueNote,
  plannedValueText,
  priceText,
  shortDay,
  toProjectBilling,
} from "../domain/billing";
import { parseWholeRupees } from "../domain/money";
import {
  adjustSchema,
  clearAdjustSchema,
  historySchema,
  markAllBilledSchema,
  markBilledSchema,
  markNotBilledSchema,
  plannedValueSchema,
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
        achievedCalculated: 10000,
        remaining: 35000,
        mark: { billed: false, billedOn: null, note: null },
        adjustment: null,
      },
      planned: [],
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
      line: {
        cycleId: null,
        state: "in_progress",
        achieved: 0,
        achievedCalculated: 0,
        mark: { billed: false, billedOn: null, note: null },
        adjustment: null,
      },
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
      line: {
        was_due: false,
        ready_to_complete: false,
        delivery_date: "2026-12-01",
        state: "open",
      },
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

describe("oneTimeStatusExpected: the skeleton reserves the status line without a money read", () => {
  const base = { working: true, deliveryDate: null, today: "2026-11-19", itemStates: ["open"] };

  it("is false for a working project that is neither late nor finished", () => {
    expect(oneTimeStatusExpected(base)).toBe(false);
    expect(oneTimeStatusExpected({ ...base, deliveryDate: "2026-11-19" })).toBe(false);
    expect(oneTimeStatusExpected({ ...base, deliveryDate: "2026-12-01" })).toBe(false);
  });

  it('is true past the delivery date ("Was due")', () => {
    expect(oneTimeStatusExpected({ ...base, deliveryDate: "2026-11-18" })).toBe(true);
  });

  it('is true when every deliverable is finished ("Ready to complete")', () => {
    expect(oneTimeStatusExpected({ ...base, itemStates: ["approved", "cancelled"] })).toBe(true);
    // One still open, or done and waiting for approval: not ready.
    expect(oneTimeStatusExpected({ ...base, itemStates: ["approved", "done"] })).toBe(false);
    // No deliverables at all: nothing to complete.
    expect(oneTimeStatusExpected({ ...base, itemStates: [] })).toBe(false);
  });

  it("is false once the project is completed or cancelled, whatever its dates", () => {
    expect(
      oneTimeStatusExpected({
        working: false,
        deliveryDate: "2026-01-01",
        today: "2026-11-19",
        itemStates: ["approved"],
      }),
    ).toBe(false);
  });
});

describe("v2.5: Billed, the adjustment and the planned values", () => {
  const retainerRead = (over: Record<string, unknown> = {}) =>
    toProjectBilling({
      project_id: ID,
      recurrence: "monthly",
      billing: { category: "retainer", category_is_default: true, cycle_amount: 40000 },
      cycle: {
        cycle_id: OTHER,
        label: "November 2026",
        amount: 40000,
        potential: 40000,
        achieved: 9000,
        achieved_calculated: 10000,
        remaining: 31000,
        billing_status: "billed",
        billed_on: "2026-12-03",
        billing_note: "Invoice 42",
        override: {
          adjusted_value: 9000,
          calculated_value: 10000,
          note: "Discount agreed",
          at: "2026-12-03T10:00:00Z",
        },
      },
      items: [
        { item_id: ID, title: "Reel 1", method: "explicit", value: 10000, achieved: true },
        { item_id: OTHER, title: "Reel 2", method: "split", value: 15000, achieved: false },
        { item_id: OTHER, title: "Reel 3", method: "excluded", value: 0, achieved: false },
      ],
      added: [],
      ...over,
    });

  it("reads the mark, the adjustment and the planned deliverables", () => {
    const billing = retainerRead();
    if (billing.kind !== "retainer" || !billing.cycle) throw new Error("a retainer with a cycle");
    expect(billing.cycle.mark).toEqual({
      billed: true,
      billedOn: "2026-12-03",
      note: "Invoice 42",
    });
    expect(billing.cycle.adjustment).toEqual({
      adjustedValue: 9000,
      calculatedValue: 10000,
      note: "Discount agreed",
      at: "2026-12-03T10:00:00Z",
    });
    expect(billing.cycle.achievedCalculated).toBe(10000);
    expect(billing.planned.map((item) => [item.title, item.method, item.value])).toEqual([
      ["Reel 1", "explicit", 10000],
      ["Reel 2", "split", 15000],
      ["Reel 3", "excluded", 0],
    ]);
    expect(() =>
      retainerRead({ items: [{ item_id: ID, title: "X", method: "guess", value: 1 }] }),
    ).toThrow();
  });

  it("a Not billed mark carries no day or note", () => {
    const billing = retainerRead({
      cycle: { cycle_id: OTHER, billing_status: "not_billed", billed_on: "2026-12-03" },
    });
    if (billing.kind !== "retainer" || !billing.cycle) throw new Error("a retainer with a cycle");
    expect(billing.cycle.mark).toEqual({ billed: false, billedOn: null, note: null });
    expect(billing.cycle.adjustment).toBe(null);
  });

  it("says Billed with its day and note, or Not billed", () => {
    expect(billedText({ billed: true, billedOn: "2026-12-03", note: "Invoice 42" })).toBe(
      "Billed on 3 Dec · Invoice 42",
    );
    expect(billedText({ billed: true, billedOn: "2026-12-03", note: null })).toBe(
      "Billed on 3 Dec",
    );
    expect(billedText({ billed: false, billedOn: null, note: null })).toBe("Not billed");
  });

  it("the Adjust row: as calculated, or the Owner's figure with the system's beside it", () => {
    expect(
      adjustmentLines({ achieved: 10000, achievedCalculated: 10000, adjustment: null }),
    ).toEqual({ label: "Achieved", value: "₹10,000", detail: "As calculated from approved work" });
    expect(
      adjustmentLines({
        achieved: 9000,
        achievedCalculated: 10000,
        adjustment: { adjustedValue: 9000, calculatedValue: 10000, note: "Discount", at: "" },
      }),
    ).toEqual({
      label: "Owner adjusted · Discount",
      value: "₹9,000",
      detail: "System calculated ₹10,000",
    });
  });

  it("adjusts a retainer's cycle in view, and a one-time project only once completed", () => {
    expect(canAdjust(retainerRead())).toBe(true);
    expect(canAdjust(retainerRead({ cycle: null }))).toBe(false);
    const oneTime = (state: string) =>
      toProjectBilling({
        project_id: ID,
        recurrence: "one_time",
        billing: { category: "project", category_is_default: true, fixed_amount: 60000 },
        line: { state, cycle_id: OTHER, achieved: 0, achieved_calculated: 0 },
        advances: [],
      });
    expect(canAdjust(oneTime("completed"))).toBe(true);
    expect(canAdjust(oneTime("in_progress"))).toBe(false);
    expect(canAdjust(oneTime("cancelled"))).toBe(false);
  });

  it("says each planned deliverable's value and how it is valued", () => {
    const item = { itemId: ID, title: "Reel 1", value: 10000 };
    expect(plannedValueText({ ...item, method: "explicit" })).toBe("₹10,000 · Own value");
    expect(plannedValueText({ ...item, method: "split" })).toBe("₹10,000 · Share");
    expect(plannedValueText({ ...item, method: "no_amount" })).toBe("No amount set");
    expect(plannedValueText({ ...item, method: "excluded" })).toBe("Not counted");
    expect(plannedHeading(4)).toBe("Planned deliverables · 4");
    expect(plannedValueNote("Reel 1", 40000, "monthly")).toBe(
      "Reel 1's own value comes off the top of this month's ₹40,000. The other planned deliverables share the rest.",
    );
    expect(plannedValueNote("Reel 1", null, "weekly")).toContain("this week's amount");
  });
});

describe("v2.5 schemas", () => {
  const TODAY = todayIST();

  it("Billed: a day up to today and an optional note", () => {
    expect(markBilledSchema.parse({ cycleId: ID, billedOn: TODAY, note: " " })).toEqual({
      cycleId: ID,
      billedOn: TODAY,
      note: null,
    });
    expect(
      markBilledSchema.safeParse({ cycleId: ID, billedOn: addISTDays(TODAY, 1) }).success,
    ).toBe(false);
    expect(markNotBilledSchema.safeParse({ cycleId: "x" }).success).toBe(false);
  });

  it("Mark all billed: at least one cycle, each a uuid", () => {
    expect(markAllBilledSchema.safeParse({ cycleIds: [], billedOn: TODAY }).success).toBe(false);
    expect(markAllBilledSchema.safeParse({ cycleIds: [ID, OTHER], billedOn: TODAY }).success).toBe(
      true,
    );
    expect(markAllBilledSchema.safeParse({ cycleIds: ["x"], billedOn: TODAY }).success).toBe(false);
  });

  it("an adjustment: whole rupees and a note, both required; back to calculated needs a note", () => {
    const base = { scope: "cycle", refId: ID };
    expect(adjustSchema.safeParse({ ...base, value: 9000, note: "Discount" }).success).toBe(true);
    expect(adjustSchema.safeParse({ ...base, value: 9000, note: "  " }).success).toBe(false);
    expect(adjustSchema.safeParse({ ...base, value: 90.5, note: "x" }).success).toBe(false);
    expect(adjustSchema.safeParse({ scope: "month", refId: ID, value: 1, note: "x" }).success).toBe(
      false,
    );
    expect(clearAdjustSchema.safeParse({ ...base, note: "" }).success).toBe(false);
    expect(clearAdjustSchema.safeParse({ ...base, note: "Paid in full" }).success).toBe(true);
  });

  it("a planned value: whole rupees, or null for back to the share", () => {
    expect(plannedValueSchema.parse({ itemId: ID, value: null })).toEqual({
      itemId: ID,
      value: null,
    });
    expect(plannedValueSchema.safeParse({ itemId: ID, value: -1 }).success).toBe(false);
  });

  it("a history page: the project, 1–200 rows, and whether it is one-time, from the query", () => {
    expect(historySchema.parse({ projectId: ID, limit: "40", oneTime: "1" })).toEqual({
      projectId: ID,
      limit: 40,
      oneTime: true,
    });
    expect(historySchema.safeParse({ projectId: ID, limit: "201", oneTime: "0" }).success).toBe(
      false,
    );
    expect(historySchema.safeParse({ projectId: ID, limit: "20", oneTime: null }).success).toBe(
      false,
    );
  });
});
