import { describe, expect, it } from "vitest";

import { closedMonthLine } from "../domain/billing";
import {
  billingAtCloseText,
  changedSinceCloseQuick,
  closedRevenueMonth,
  closedRevenueView,
} from "../domain/closed-month";
import { toRevenueMonth } from "../domain/revenue";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";
const P2 = "44444444-4444-4444-8444-444444444444";
const Y1 = "77777777-7777-4777-8777-777777777777";
const Y2 = "88888888-8888-4888-8888-888888888888";
const A1 = "99999999-9999-4999-8999-999999999999";

const cycle = (over: Record<string, unknown> = {}) => ({
  client_id: C1,
  client_name: "Zeta Foods",
  project_id: P1,
  project_name: "Monthly reels",
  cycle_id: Y1,
  label: "September 2026",
  category: "retainer",
  amount: 40000,
  potential: 40000,
  achieved: 10000,
  closed_not_achieved: 0,
  remaining: 30000,
  added_value: 0,
  added_count: 0,
  not_priced_count: 0,
  plan_count: 4,
  done_count: 1,
  held: false,
  billing_status: "not_billed",
  ...over,
});

const project = (over: Record<string, unknown> = {}) => ({
  client_id: C2,
  client_name: "Acme Studio",
  project_id: P2,
  project_name: "Brand film",
  category: "project",
  state: "in_progress",
  delivery_date: "2026-09-15",
  amount: 60000,
  potential: 60000,
  achieved: 0,
  closed_not_achieved: 0,
  remaining: 60000,
  was_due: true,
  ready_to_complete: false,
  held: false,
  advances_kept: 0,
  advances_returned: 0,
  billing_status: "not_billed",
  ...over,
});

const advance = {
  advance_id: A1,
  event: "received",
  on_date: "2026-09-03",
  amount: 5000,
  project_id: P2,
};

const live = (over: Record<string, unknown> = {}) =>
  toRevenueMonth({
    month: "2026-09-01",
    this_month: "2026-11-01",
    months: ["2026-09-01", "2026-10-01"],
    cycles: [cycle()],
    projects: [project()],
    advances: [advance],
    ...over,
  });

const snapshot = (over: Record<string, unknown> = {}) => ({
  schema: 1,
  revenue: {
    cycles: [cycle()],
    projects: [project()],
    advances: [advance],
    totals: {},
    ...over,
  },
});

describe("closedRevenueMonth: the latest version's lines in the page's shape", () => {
  it("draws the stored figures with the live month, switcher months and today's names", () => {
    const month = closedRevenueMonth(
      snapshot({ cycles: [cycle({ achieved: 20000, remaining: 20000, client_name: "Old name" })] }),
      live({ cycles: [cycle({ client_name: "Zeta Foods Ltd", label: "Sept 2026" })] }),
    );
    expect(month.month).toBe("2026-09-01");
    expect(month.thisMonth).toBe("2026-11-01");
    expect(month.months).toEqual(["2026-09-01", "2026-10-01"]);
    expect(month.lines[0]).toMatchObject({
      kind: "cycle",
      achieved: 20000,
      clientName: "Zeta Foods Ltd",
      label: "Sept 2026",
    });
  });

  it("keeps the stored names of a line no longer in the live month", () => {
    const month = closedRevenueMonth(snapshot(), live({ cycles: [], projects: [], advances: [] }));
    expect(month.lines.map((line) => line.clientName)).toEqual(["Zeta Foods", "Acme Studio"]);
  });

  it("refuses a shape it does not read, without repeating a value", () => {
    expect(() => closedRevenueMonth({ schema: 2, revenue: {} }, live())).toThrow(
      "This snapshot is in a shape MaxOff does not read yet.",
    );
  });
});

describe("changedSinceCloseQuick: the cheap check on the Revenue page", () => {
  const stored = closedRevenueMonth(snapshot(), live());

  it("is false when nothing on the page moved, a rename and a billing mark included", () => {
    expect(changedSinceCloseQuick(stored, live())).toBe(false);
    expect(
      changedSinceCloseQuick(
        stored,
        live({ cycles: [cycle({ client_name: "Renamed", billing_status: "billed" })] }),
      ),
    ).toBe(false);
  });

  it("is true when a figure moved, a line came or went, or an advance changed", () => {
    expect(
      changedSinceCloseQuick(stored, live({ cycles: [cycle({ achieved: 0, remaining: 40000 })] })),
    ).toBe(true);
    expect(changedSinceCloseQuick(stored, live({ cycles: [cycle({ done_count: 2 })] }))).toBe(true);
    expect(changedSinceCloseQuick(stored, live({ cycles: [cycle({ amount: null })] }))).toBe(true);
    expect(
      changedSinceCloseQuick(stored, live({ cycles: [cycle(), cycle({ cycle_id: Y2 })] })),
    ).toBe(true);
    expect(changedSinceCloseQuick(stored, live({ projects: [] }))).toBe(true);
    expect(changedSinceCloseQuick(stored, live({ advances: [] }))).toBe(true);
    expect(changedSinceCloseQuick(stored, live({ advances: [{ ...advance, amount: 6000 }] }))).toBe(
      true,
    );
  });

  it("compares amounts in paise, so a numeric's spelling is not a change", () => {
    expect(
      changedSinceCloseQuick(stored, live({ cycles: [cycle({ potential: "40000.00" })] })),
    ).toBe(false);
  });
});

describe("billingAtCloseText: the status at close, only where it differs from now (Q13)", () => {
  it("says nothing when they agree, or when there is no live line", () => {
    expect(billingAtCloseText("billed", "billed")).toBeNull();
    expect(billingAtCloseText("not_billed", null)).toBeNull();
  });

  it("says the status at close when it differs", () => {
    expect(billingAtCloseText("not_billed", "billed")).toBe("Not billed at close");
    expect(billingAtCloseText("billed", "not_billed")).toBe("Billed at close");
  });

  it("says nothing without a stored status", () => {
    expect(billingAtCloseText(null, "billed")).toBeNull();
  });
});

describe("closedRevenueView", () => {
  it("takes totals from the snapshot, Needs a look and the Billed mark from the live read", () => {
    const view = closedRevenueView(
      closedRevenueMonth(snapshot(), live()),
      live({
        cycles: [
          cycle({
            billing_status: "billed",
            billed_on: "2026-10-03",
            achieved: 0,
            remaining: 40000,
          }),
        ],
        projects: [project({ was_due: false, amount: null, potential: 0, remaining: 0 })],
      }),
      "all",
    );
    expect(view.totals.achieved).toBe(10000);
    expect(view.exceptions.map((exception) => exception.kind)).toEqual(["no_amount"]);
    const lines = view.clients.flatMap((client) => client.lines);
    const y1 = lines.find((line) => line.kind === "cycle" && line.cycleId === Y1);
    // v2.5's "Billed 3 Oct" follows today's mark; the figures stay the snapshot's.
    expect(y1).toMatchObject({ billed: true, billedOn: "2026-10-03", achieved: 10000 });
    expect(view.atClose.get(`cycle:${Y1}`)).toBe("Not billed at close");
    expect(view.atClose.has(`project:${P2}`)).toBe(false);
    // "Mark all N billed" counts what is not billed now.
    expect(view.unbilled).not.toContain(Y1);
    expect(view.changed).toBe(true);
  });

  it("follows the category filter", () => {
    const now = live({
      cycles: [cycle({ billing_status: "billed" })],
      projects: [project({ billing_status: "billed" })],
    });
    const view = closedRevenueView(closedRevenueMonth(snapshot(), live()), now, "project");
    expect(view.clients.map((client) => client.clientId)).toEqual([C2]);
    expect([...view.atClose.keys()]).toEqual([`project:${P2}`]);
  });

  it("reads a stored line's adjustment from the snapshot's override", () => {
    const stored = closedRevenueMonth(
      snapshot({ cycles: [cycle({ override: { adjusted_value: 9000 } })] }),
      live(),
    );
    expect(stored.lines.find((line) => line.kind === "cycle")?.adjusted).toBe(true);
    expect(closedRevenueMonth(snapshot(), live()).lines.every((line) => !line.adjusted)).toBe(true);
  });
});

describe("closedMonthLine: the money sheets' line (decision 10)", () => {
  it("names a closed month in the docs' words", () => {
    expect(closedMonthLine("2026-09-15", ["2026-09-01"])).toBe(
      "September is closed. Its report changes only when you correct it.",
    );
    expect(closedMonthLine("2026-09-01", ["2026-08-01", "2026-09-01"])).not.toBeNull();
  });

  it("says nothing for an open month or no date", () => {
    expect(closedMonthLine("2026-10-02", ["2026-09-01"])).toBeNull();
    expect(closedMonthLine(null, ["2026-09-01"])).toBeNull();
    expect(closedMonthLine("", ["2026-09-01"])).toBeNull();
  });
});
