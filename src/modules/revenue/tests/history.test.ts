import { describe, expect, it } from "vitest";

import { historyEntries, type HistoryRow, historyWords, toHistoryRows } from "../domain/history";
import { HISTORY_MAX, HISTORY_PAGE, mayHaveOlder, nextHistoryLimit } from "../domain/history-page";

/** One audit row, as `project_billing_history` answers it, with what a test changes. */
function row(over: Partial<HistoryRow>): HistoryRow {
  return {
    id: "1",
    at: "2026-12-03T10:35:00Z",
    entity: "project_billing",
    action: "amount_set",
    actorName: "Owner Name",
    old: {},
    new: {},
    subject: null,
    ...over,
  };
}

const retainer = { oneTime: false };
const oneTime = { oneTime: true };

describe("historyWords: the project's own billing", () => {
  it("an amount set, changed and removed, with what it was (nothing for a first amount)", () => {
    expect(historyWords(row({ new: { cycle_amount: 10000 } }), retainer)).toBe(
      "Amount set to ₹10,000",
    );
    expect(
      historyWords(row({ old: { cycle_amount: 8000 }, new: { cycle_amount: 10000 } }), retainer),
    ).toBe("Amount set to ₹10,000 (was ₹8,000)");
    expect(
      historyWords(row({ old: { fixed_amount: 60000 }, new: { fixed_amount: null } }), oneTime),
    ).toBe("Amount removed (was ₹60,000)");
    expect(
      historyWords(row({ old: { fixed_amount: null }, new: { fixed_amount: 0 } }), oneTime),
    ).toBe("Amount set to Not billable");
  });

  it("a category set, with the one before when there was one", () => {
    expect(
      historyWords(
        row({ action: "category_set", new: { billing_category: "additional_work" } }),
        retainer,
      ),
    ).toBe("Category set to Additional Work");
    expect(
      historyWords(
        row({
          action: "category_set",
          old: { billing_category: "retainer" },
          new: { billing_category: "project" },
        }),
        retainer,
      ),
    ).toBe("Category set to Project (was Retainer)");
  });

  it("leaves out the empty billing row made before the first change", () => {
    expect(
      historyWords(row({ action: "billing_started", new: { project_id: "p" } }), retainer),
    ).toBe(null);
  });
});

describe("historyWords: a cycle's billing", () => {
  const cycle = (over: Partial<HistoryRow>) =>
    row({ entity: "cycle_billing", subject: "November 2026", ...over });

  it("Billed on a day with its note, and back to Not billed", () => {
    expect(
      historyWords(
        cycle({ action: "billed", new: { billing_status: "billed", billed_on: "2026-12-03" } }),
        retainer,
      ),
    ).toBe("November 2026: marked billed on 3 Dec");
    expect(
      historyWords(
        cycle({ action: "billed", new: { billed_on: "2026-12-03", note: "Invoice 42" } }),
        oneTime,
      ),
    ).toBe("Marked billed on 3 Dec: Invoice 42");
    expect(historyWords(cycle({ action: "not_billed" }), retainer)).toBe(
      "November 2026: marked not billed",
    );
    expect(historyWords(cycle({ action: "not_billed" }), oneTime)).toBe("Marked not billed");
  });

  it("a cycle's own amount, and a new cycle copying the project's", () => {
    expect(
      historyWords(
        cycle({ action: "amount_set", old: { cycle_amount: null }, new: { cycle_amount: 25000 } }),
        retainer,
      ),
    ).toBe("November 2026: amount set to ₹25,000");
    expect(historyWords(cycle({ action: "insert", new: { cycle_amount: 40000 } }), retainer)).toBe(
      "November 2026: amount set to ₹40,000 from the project's amount",
    );
  });
});

describe("historyWords: deliverables, advances and adjustments", () => {
  it("a deliverable's price set, changed and cleared", () => {
    const item = (over: Partial<HistoryRow>) =>
      row({ entity: "item_billing", subject: "Reel 2", ...over });
    expect(historyWords(item({ action: "value_set", new: { value: 2000 } }), retainer)).toBe(
      "Price of Reel 2 set to ₹2,000",
    );
    expect(
      historyWords(
        item({ action: "value_set", old: { value: 1500 }, new: { value: 2000 } }),
        retainer,
      ),
    ).toBe("Price of Reel 2 set to ₹2,000 (was ₹1,500)");
    expect(
      historyWords(
        item({ action: "value_cleared", old: { value: 2000 }, new: { value: null } }),
        retainer,
      ),
    ).toBe("Price of Reel 2 cleared (was ₹2,000)");
    // The bare "added" mark is not a billing change (the read leaves it out too).
    expect(historyWords(item({ action: "insert", new: { added: true } }), retainer)).toBe(null);
  });

  it("an advance received and returned", () => {
    const advance = (over: Partial<HistoryRow>) => row({ entity: "project_advances", ...over });
    expect(
      historyWords(
        advance({ action: "advance_recorded", new: { amount: 30000, received_on: "2026-12-01" } }),
        oneTime,
      ),
    ).toBe("Advance ₹30,000 received on 1 Dec");
    expect(
      historyWords(
        advance({
          action: "advance_recorded",
          new: { amount: 30000, received_on: "2026-12-01", note: "On signing" },
        }),
        oneTime,
      ),
    ).toBe("Advance ₹30,000 received on 1 Dec: On signing");
    expect(
      historyWords(
        advance({
          action: "advance_returned",
          new: { returned_on: "2026-12-05", return_note: "Called off" },
        }),
        oneTime,
      ),
    ).toBe("Advance returned on 5 Dec: Called off");
  });

  it("an adjustment with its note, back to calculated, and the superseded row left out", () => {
    const override = (over: Partial<HistoryRow>) =>
      row({ entity: "revenue_overrides", subject: "November 2026", ...over });
    expect(
      historyWords(
        override({
          action: "override_set",
          new: { adjusted_value: 9000, calculated_value: 10000, note: "Discount agreed" },
        }),
        retainer,
      ),
    ).toBe("November 2026: adjusted to ₹9,000: Discount agreed");
    expect(
      historyWords(
        override({ action: "override_set", subject: null, new: { adjusted_value: 55000 } }),
        oneTime,
      ),
    ).toBe("Adjusted to ₹55,000");
    expect(
      historyWords(
        override({ action: "override_cleared", new: { superseded_note: "Paid in full" } }),
        retainer,
      ),
    ).toBe("November 2026: back to calculated: Paid in full");
    expect(historyWords(override({ action: "override_superseded" }), retainer)).toBe(null);
  });

  it("says nothing for a table it does not know", () => {
    expect(historyWords(row({ entity: "tasks", action: "update" }), retainer)).toBe(null);
  });
});

describe("historyEntries: the read as the history's lines", () => {
  it("keeps the read's order, words each row with when (IST) and who, drops the silent ones", () => {
    const rows = toHistoryRows([
      {
        id: "3",
        at: "2026-12-03T10:35:00Z",
        entity: "cycle_billing",
        action: "billed",
        actor_name: "Owner Name",
        old: { billing_status: "not_billed" },
        new: { billing_status: "billed", billed_on: "2026-12-03" },
        subject: "November 2026",
      },
      {
        id: "2",
        at: "2026-12-01T05:00:00Z",
        entity: "project_billing",
        action: "billing_started",
        actor_name: "Owner Name",
        old: {},
        new: {},
        subject: null,
      },
      {
        // A bigint id arrives as a JSON number.
        id: 1,
        at: "2026-11-30T20:00:00Z",
        entity: "cycle_billing",
        action: "insert",
        actor_name: null,
        old: {},
        new: { cycle_amount: 40000 },
        subject: "December 2026",
      },
    ]);
    expect(historyEntries(rows, retainer)).toEqual([
      {
        id: "3",
        when: "3 Dec 2026, 4:05 pm",
        who: "Owner Name",
        what: "November 2026: marked billed on 3 Dec",
      },
      {
        id: "1",
        when: "1 Dec 2026, 1:30 am",
        who: "MaxOff",
        what: "December 2026: amount set to ₹40,000 from the project's amount",
      },
    ]);
  });

  it("refuses an answer that is not the read's", () => {
    expect(() => toHistoryRows(null)).toThrow();
    expect(() => toHistoryRows([{ entity: "x" }])).toThrow();
  });
});

describe("the history's pages", () => {
  it("20 at first, 20 more each time, never past 200", () => {
    expect(HISTORY_PAGE).toBe(20);
    expect(nextHistoryLimit(20)).toBe(40);
    expect(nextHistoryLimit(190)).toBe(HISTORY_MAX);
    expect(nextHistoryLimit(200)).toBe(200);
  });

  it("offers older rows only when the page came back full and under the cap", () => {
    expect(mayHaveOlder(20, 20)).toBe(true);
    expect(mayHaveOlder(19, 20)).toBe(false);
    expect(mayHaveOlder(200, 200)).toBe(false);
  });
});
