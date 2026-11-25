import { describe, expect, it } from "vitest";

import { cycleAmountLabel, cycleAmountNote } from "../domain/billing";
import {
  advanceTotals,
  exceptionsOf,
  filterLines,
  groupByClient,
  lineBilling,
  lineFigure,
  lineHref,
  lineNotes,
  lineStatus,
  hasSomethingToBill,
  markAllLabel,
  monthSwitcher,
  onHoldOf,
  onHoldText,
  parseCategory,
  parseMonth,
  revenueHref,
  revenueView,
  shiftMonth,
  toRevenueMonth,
  totalsOf,
  unbilledCycleIds,
} from "../domain/revenue";
import { setCycleAmountSchema } from "../domain/schemas";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";
const P2 = "44444444-4444-4444-8444-444444444444";
const P3 = "55555555-5555-4555-8555-555555555555";
const P4 = "66666666-6666-4666-8666-666666666666";
const Y1 = "77777777-7777-4777-8777-777777777777";
const Y2 = "88888888-8888-4888-8888-888888888888";
const A1 = "99999999-9999-4999-8999-999999999999";
const A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cycle = (over: Record<string, unknown> = {}) => ({
  client_id: C1,
  client_name: "Zeta Foods",
  project_id: P1,
  project_name: "Monthly reels",
  cycle_id: Y1,
  label: "November 2026",
  category: "retainer",
  amount: 40000,
  potential: 42718,
  achieved: 13333.34,
  achieved_calculated: 13333.34,
  closed_not_achieved: 0,
  remaining: 29384.66,
  added_value: 2718,
  added_count: 2,
  not_priced_count: 1,
  plan_count: 12,
  done_count: 4,
  held: false,
  ...over,
});

const project = (over: Record<string, unknown> = {}) => ({
  client_id: C2,
  client_name: "acme Studio",
  project_id: P2,
  project_name: "Brand film",
  category: "project",
  state: "in_progress",
  delivery_date: "2026-11-15",
  amount: 60000,
  potential: 60000,
  achieved: 0,
  achieved_calculated: 0,
  closed_not_achieved: 0,
  was_due: true,
  ready_to_complete: false,
  held: false,
  advances_kept: 30000,
  ...over,
});

const read = (over: Record<string, unknown> = {}) =>
  toRevenueMonth({
    month: "2026-11-01",
    this_month: "2026-11-01",
    months: ["2026-11-01", "2026-09-01", "2026-12-01"],
    cycles: [cycle()],
    projects: [project()],
    advances: [
      { advance_id: A1, event: "received", on_date: "2026-11-03", amount: 30000, project_id: P2 },
      { advance_id: A2, event: "returned", on_date: "2026-11-09", amount: 5000.5, project_id: P3 },
    ],
    ...over,
  });

describe("toRevenueMonth: the read in the page's own names", () => {
  it("maps a cycle and a one-time project, and sorts the months", () => {
    const month = read();
    expect(month.month).toBe("2026-11-01");
    expect(month.months).toEqual(["2026-09-01", "2026-11-01", "2026-12-01"]);
    expect(month.lines).toHaveLength(2);
    expect(month.lines[0]).toMatchObject({
      kind: "cycle",
      clientName: "Zeta Foods",
      cycleId: Y1,
      amount: 40000,
      potential: 42718,
      remaining: 29384.66,
      addedValue: 2718,
      notPricedCount: 1,
      planCount: 12,
      doneCount: 4,
    });
    expect(month.lines[1]).toMatchObject({
      kind: "project",
      state: "in_progress",
      wasDue: true,
      advancesKept: 30000,
      // Potential − Achieved.
      remaining: 60000,
    });
    expect(month.advances.map((advance) => advance.event)).toEqual(["received", "returned"]);
  });

  it("keeps a missing amount as null (No amount set), not zero", () => {
    const month = read({ cycles: [cycle({ amount: null, potential: 0, remaining: 0 })] });
    expect(month.lines[0]?.amount).toBeNull();
    expect(month.lines[0]?.potential).toBe(0);
  });

  it("works a one-time line's remaining out in paise, never below zero", () => {
    const [done, over] = read({
      cycles: [],
      projects: [
        project({ state: "completed", potential: 0.3, achieved: 0.1 }),
        // An Owner-adjusted figure above the amount leaves nothing remaining.
        project({ project_id: P3, state: "completed", potential: 100, achieved: 150 }),
      ],
    }).lines;
    expect(done?.remaining).toBe(0.2);
    expect(over?.remaining).toBe(0);
  });

  it("takes numerics that arrive as strings, and empty lists", () => {
    const month = toRevenueMonth({
      month: "2026-11-01",
      this_month: "2026-11-01",
      months: [],
      cycles: [cycle({ amount: "40000.00", potential: "40000.00" })],
      projects: null,
      advances: [],
    });
    expect(month.lines[0]?.amount).toBe(40000);
    expect(month.lines).toHaveLength(1);
    expect(month.advances).toEqual([]);
  });

  it("refuses an answer it cannot read, without repeating any value", () => {
    expect(() => toRevenueMonth(null)).toThrow("The revenue read's answer is missing.");
    expect(() => read({ cycles: [cycle({ potential: "12x" })] })).toThrow(
      "The revenue read holds an amount that is not one.",
    );
    expect(() => read({ projects: [project({ state: "paused" })] })).toThrow(
      "The revenue read holds a project state MaxOff does not know.",
    );
  });
});

describe("the address: month and category", () => {
  it("parses ?month=YYYY-MM and nothing else", () => {
    expect(parseMonth("2026-09")).toBe("2026-09-01");
    for (const bad of ["2026-13", "2026-9", "2026-09-01", "", undefined, ["2026-09"], "x"]) {
      expect(parseMonth(bad)).toBeNull();
    }
  });

  it("parses ?category=, anything else is all", () => {
    expect(parseCategory("additional_work")).toBe("additional_work");
    expect(parseCategory("retainer")).toBe("retainer");
    expect(parseCategory("all")).toBe("all");
    expect(parseCategory("money")).toBe("all");
    expect(parseCategory(undefined)).toBe("all");
  });

  it("shifts months across a year's end", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-11-01", -14)).toBe("2025-09-01");
    expect(shiftMonth("2026-11-01", 0)).toBe("2026-11-01");
  });

  it("leaves this month and All out of the address", () => {
    expect(revenueHref({ month: "2026-11-01", category: "all" }, "2026-11-01")).toBe(
      "/reports/revenue",
    );
    expect(revenueHref({ month: "2026-10-01", category: "all" }, "2026-11-01")).toBe(
      "/reports/revenue?month=2026-10",
    );
    expect(revenueHref({ month: "2026-10-01", category: "project" }, "2026-11-01")).toBe(
      "/reports/revenue?month=2026-10&category=project",
    );
    expect(revenueHref({ month: "2026-11-01", category: "retainer" }, "2026-11-01")).toBe(
      "/reports/revenue?category=retainer",
    );
  });

  it("the switcher steps a month at a time between the first and last month with anything", () => {
    const months = ["2026-09-01", "2026-12-01"];
    const at = (month: string) => monthSwitcher({ month, thisMonth: "2026-11-01", months });
    expect(at("2026-11-01")).toEqual({
      label: "November 2026",
      previous: "2026-10-01",
      next: "2026-12-01",
    });
    expect(at("2026-09-01")).toMatchObject({ previous: null, next: "2026-10-01" });
    expect(at("2026-12-01")).toMatchObject({ previous: "2026-11-01", next: null });
  });

  it("this month is always reachable, and alone has no arrows", () => {
    expect(
      monthSwitcher({ month: "2026-11-01", thisMonth: "2026-11-01", months: [] }),
    ).toMatchObject({ previous: null, next: null });
    // Looking at an old month with nothing later listed: forward leads back to this month.
    expect(
      monthSwitcher({ month: "2026-08-01", thisMonth: "2026-11-01", months: ["2026-08-01"] }),
    ).toMatchObject({ previous: null, next: "2026-09-01" });
  });
});

describe("totals: summed in paise", () => {
  it("adds Potential, Achieved, Remaining and Closed across cycles and one-time lines", () => {
    const totals = totalsOf(read().lines);
    expect(totals).toEqual({
      potential: 102718,
      achieved: 13333.34,
      remaining: 89384.66,
      onHold: 0,
      closedNotAchieved: 0,
    });
  });

  it("is exact where floating point is not (0.1 + 0.2, thirds of a rupee)", () => {
    const thirds = read({
      projects: [],
      cycles: [
        cycle({ potential: 0.1, achieved: 0.1, remaining: 0 }),
        cycle({ cycle_id: Y2, potential: 0.2, achieved: 0.2, remaining: 0 }),
        cycle({ cycle_id: A1, potential: 13333.33, achieved: 13333.33, remaining: 0 }),
        cycle({ cycle_id: A2, potential: 13333.34, achieved: 13333.34, remaining: 0 }),
      ],
    }).lines;
    expect(totalsOf(thirds.slice(0, 2)).potential).toBe(0.3);
    expect(totalsOf(thirds).achieved).toBe(26666.97);
  });

  it("is all zero for no lines", () => {
    expect(totalsOf([])).toEqual({
      potential: 0,
      achieved: 0,
      remaining: 0,
      onHold: 0,
      closedNotAchieved: 0,
    });
  });

  it("counts a cancelled one-time project as closed, not achieved", () => {
    const lines = read({
      cycles: [],
      projects: [project({ state: "cancelled", closed_not_achieved: 60000, was_due: false })],
    }).lines;
    expect(totalsOf(lines)).toMatchObject({ achieved: 0, closedNotAchieved: 60000 });
  });
});

describe("advances: apart from Achieved", () => {
  it("sums what was received and what was returned in the month", () => {
    expect(advanceTotals(read().advances)).toEqual({ received: 30000, returned: 5000.5 });
    expect(advanceTotals([])).toEqual({ received: 0, returned: 0 });
  });

  it("under a filter, counts only the advances of the projects shown", () => {
    const month = read();
    const shown = filterLines(month.lines, "project");
    expect(advanceTotals(month.advances, shown)).toEqual({ received: 30000, returned: 0 });
    expect(advanceTotals(month.advances, filterLines(month.lines, "retainer"))).toEqual({
      received: 0,
      returned: 0,
    });
  });

  it("never changes Achieved", () => {
    const view = revenueView(read(), "all");
    expect(view.totals.achieved).toBe(13333.34);
    expect(view.advances.received).toBe(30000);
  });
});

describe("the category filter", () => {
  const month = read({
    cycles: [cycle(), cycle({ cycle_id: Y2, project_id: P4, category: "additional_work" })],
    projects: [
      project(),
      project({
        project_id: P3,
        category: "additional_work",
        amount: 5000,
        potential: 5000,
        was_due: false,
      }),
    ],
  });

  it("keeps every line for All, and only a category's otherwise", () => {
    expect(filterLines(month.lines, "all")).toHaveLength(4);
    expect(filterLines(month.lines, "retainer").map((line) => line.projectId)).toEqual([P1]);
    expect(filterLines(month.lines, "project").map((line) => line.projectId)).toEqual([P2]);
    expect(filterLines(month.lines, "additional_work").map((line) => line.projectId)).toEqual([
      P4,
      P3,
    ]);
  });

  it("recomputes the totals, the groups and the exceptions for the category", () => {
    const all = revenueView(month, "all");
    const extra = revenueView(month, "additional_work");
    expect(all.totals.potential).toBe(42718 * 2 + 60000 + 5000);
    expect(extra.totals.potential).toBe(42718 + 5000);
    expect(extra.clients.map((client) => client.clientName)).toEqual(["acme Studio", "Zeta Foods"]);
    expect(extra.exceptions.map((exception) => exception.kind)).toEqual(["not_priced"]);
    expect(revenueView(month, "project").exceptions.map((exception) => exception.kind)).toEqual([
      "was_due",
    ]);
  });

  it("says a category with nothing is empty, and a month with only an advance is not", () => {
    expect(revenueView(read({ cycles: [], projects: [] }), "all").empty).toBe(false);
    expect(revenueView(read({ cycles: [], projects: [], advances: [] }), "all").empty).toBe(true);
    expect(revenueView(read({ projects: [] }), "project").empty).toBe(true);
    expect(revenueView(read(), "all").empty).toBe(false);
  });
});

describe("by client", () => {
  it("groups by client, by name whatever the case, each with its own totals", () => {
    const groups = groupByClient(
      read({
        cycles: [cycle(), cycle({ cycle_id: Y2, project_id: P4, project_name: "A weekly" })],
      }).lines,
    );
    expect(groups.map((group) => group.clientName)).toEqual(["acme Studio", "Zeta Foods"]);
    expect(groups[1]?.lines.map((line) => line.projectName)).toEqual(["A weekly", "Monthly reels"]);
    expect(groups[1]?.totals.potential).toBe(85436);
    expect(groups[0]?.totals).toMatchObject({ potential: 60000, achieved: 0, remaining: 60000 });
  });

  it("keeps two clients of the same name apart", () => {
    const groups = groupByClient(
      read({ projects: [project({ client_name: "Zeta Foods" })] }).lines,
    );
    expect(groups).toHaveLength(2);
  });
});

describe("what a line says", () => {
  const [retainer, oneTime] = read().lines;

  it("a retainer's cycle: its label, what is done, what was added and what is not priced", () => {
    expect(lineStatus(retainer!)).toBe("November 2026 · 4 of 14 done");
    expect(lineNotes(retainer!)).toEqual(["+₹2,718 added", "1 not priced"]);
    expect(lineFigure(retainer!)).toBe("₹42,718");
    expect(lineHref(retainer!)).toBe(`/clients/${C1}/projects/${P1}?cycle=${Y1}#project-billing`);
  });

  it("a one-time project: due, was due, ready, completed, cancelled; its advance", () => {
    expect(lineStatus(oneTime!)).toBe("Was due 15 Nov");
    expect(lineNotes(oneTime!)).toEqual(["Advance ₹30,000"]);
    expect(lineHref(oneTime!)).toBe(`/clients/${C2}/projects/${P2}#project-billing`);
    const says = (over: Record<string, unknown>) =>
      lineStatus(read({ cycles: [], projects: [project(over)] }).lines[0]!);
    expect(says({ was_due: false })).toBe("Due 15 Nov");
    expect(says({ was_due: false, ready_to_complete: true })).toBe(
      "Due 15 Nov · Ready to complete",
    );
    expect(says({ state: "completed", was_due: false })).toBe("Completed");
    expect(says({ state: "cancelled", was_due: false })).toBe("Cancelled · closed, not achieved");
    expect(says({ delivery_date: null, was_due: false })).toBe("No delivery date");
  });

  it("the figure: No amount set, Not billable, or the Potential in Indian grouping", () => {
    const figure = (over: Record<string, unknown>) =>
      lineFigure(read({ projects: [], cycles: [cycle(over)] }).lines[0]!);
    expect(figure({ amount: null, potential: 0 })).toBe("No amount set");
    expect(figure({ amount: 0, potential: 0 })).toBe("Not billable");
    // No amount, but a priced addition on top: the addition is the Potential.
    expect(figure({ amount: null, potential: 2718 })).toBe("₹2,718");
    expect(figure({ amount: 1234567, potential: 1234567 })).toBe("₹12,34,567");
  });

  it("no notes without additions or advances", () => {
    const month = read({
      cycles: [cycle({ added_value: 0, not_priced_count: 0 })],
      projects: [project({ advances_kept: 0 })],
    });
    expect(month.lines.map(lineNotes)).toEqual([[], []]);
  });
});

describe("needs a look", () => {
  it("lists each exception with its client and project, in a fixed order", () => {
    const month = read({
      cycles: [
        cycle(),
        cycle({
          cycle_id: Y2,
          project_id: P4,
          project_name: "Old reels",
          label: "October 2026",
          amount: null,
          not_priced_count: 0,
        }),
      ],
      projects: [
        project({ ready_to_complete: true }),
        project({
          project_id: P3,
          project_name: "Launch",
          amount: null,
          potential: 0,
          was_due: false,
        }),
      ],
    });
    const found = exceptionsOf(month.lines);
    expect(found.map((exception) => [exception.kind, exception.text, exception.where])).toEqual([
      ["no_amount", "No amount set", "acme Studio · Launch"],
      ["no_amount", "No amount set", "Zeta Foods · Old reels · October 2026"],
      ["not_priced", "1 not priced", "Zeta Foods · Monthly reels · November 2026"],
      ["ready_to_complete", "Ready to complete", "acme Studio · Brand film"],
      ["was_due", "Was due 15 Nov", "acme Studio · Brand film"],
    ]);
    expect(found[1]?.href).toBe(`/clients/${C1}/projects/${P4}?cycle=${Y2}#project-billing`);
    expect(new Set(found.map((exception) => exception.key)).size).toBe(found.length);
  });

  it("is empty when every line is priced, on time and not ready", () => {
    const month = read({
      cycles: [cycle({ not_priced_count: 0 })],
      projects: [project({ was_due: false })],
    });
    expect(exceptionsOf(month.lines)).toEqual([]);
  });

  it("an amount of ₹0 is an amount: Not billable is not an exception", () => {
    const month = read({ projects: [], cycles: [cycle({ amount: 0, not_priced_count: 0 })] });
    expect(exceptionsOf(month.lines)).toEqual([]);
  });
});

describe("set this month's amount", () => {
  it("names the control and the sheet's line by the repeat and the cycle", () => {
    expect(cycleAmountLabel("monthly")).toBe("Set this month's amount");
    expect(cycleAmountLabel("weekly")).toBe("Set this week's amount");
    expect(cycleAmountNote("November 2026", "monthly")).toBe(
      "Only November 2026. The project's amount is not changed.",
    );
    expect(cycleAmountNote(null, "weekly")).toBe(
      "Only this week. The project's amount is not changed.",
    );
  });

  it("the schema takes a cycle and whole rupees, zero included", () => {
    expect(setCycleAmountSchema.parse({ cycleId: Y1, amount: 40000 })).toEqual({
      cycleId: Y1,
      amount: 40000,
    });
    expect(setCycleAmountSchema.safeParse({ cycleId: Y1, amount: 0 }).success).toBe(true);
    for (const amount of [-1, 40000.5, 10_000_000_000, Number.NaN]) {
      expect(setCycleAmountSchema.safeParse({ cycleId: Y1, amount }).success).toBe(false);
    }
    expect(setCycleAmountSchema.safeParse({ cycleId: "x", amount: 1 }).success).toBe(false);
    expect(setCycleAmountSchema.safeParse({ amount: 1 }).success).toBe(false);
  });
});

describe("v2.5: On hold inside Remaining (R3)", () => {
  it("a held cycle keeps its Remaining waiting; a held one-time line its Potential less Achieved", () => {
    const lines = read({
      cycles: [
        cycle({ held: true, remaining: 29384.66 }),
        cycle({ cycle_id: Y2, remaining: 1000 }),
      ],
      projects: [
        project({ held: true, potential: 60000, achieved: 0 }),
        project({
          project_id: P3,
          held: true,
          state: "completed",
          potential: 50000,
          achieved: 55000,
        }),
      ],
    }).lines;
    expect(lines.map(onHoldOf)).toEqual([29384.66, 0, 60000, 0]);
    const totals = totalsOf(lines);
    expect(totals.onHold).toBe(89384.66);
    // Neither earned nor lost: still inside Remaining, never in Achieved or Closed.
    expect(totals.remaining).toBeGreaterThanOrEqual(totals.onHold);
    expect(onHoldText(totals.onHold)).toBe("On hold ₹89,384.66");
    expect(onHoldText(0)).toBe(null);
  });

  it("each client's card has its own On hold", () => {
    const view = revenueView(
      read({ cycles: [cycle({ held: true })], projects: [project({ held: false })] }),
      "all",
    );
    const byClient = Object.fromEntries(view.clients.map((group) => [group.clientId, group]));
    expect(byClient[C1]?.totals.onHold).toBe(29384.66);
    expect(byClient[C2]?.totals.onHold).toBe(0);
    expect(view.totals.onHold).toBe(29384.66);
  });
});

describe("v2.5: Billed on every line, and Mark all billed", () => {
  it("reads each line's mark and adjustment", () => {
    const [first, second] = read({
      cycles: [cycle({ billing_status: "billed", billed_on: "2026-12-03", adjusted: true })],
      projects: [project({ cycle_id: A1, billing_status: "not_billed", billed_on: null })],
    }).lines;
    expect(first).toMatchObject({ billed: true, billedOn: "2026-12-03", adjusted: true });
    expect(second).toMatchObject({ billed: false, billedOn: null, adjusted: false, cycleId: A1 });
    expect(lineBilling(first!)).toBe("Billed 3 Dec");
    expect(lineBilling(second!)).toBe("Not billed");
  });

  it("marks the lines shown that are not billed yet, each cycle once, one-time ones by their cycle", () => {
    const lines = read({
      cycles: [cycle(), cycle({ cycle_id: Y2, billing_status: "billed", billed_on: "2026-11-30" })],
      projects: [
        project({ cycle_id: A1 }),
        // A one-time project without its cycle cannot be marked.
        project({ project_id: P3, cycle_id: null }),
      ],
    }).lines;
    expect(unbilledCycleIds(lines)).toEqual([Y1, A1]);
    expect(revenueView(read({ cycles: [cycle()], projects: [] }), "all").unbilled).toEqual([Y1]);
    // Under a category filter, only the lines it shows.
    expect(
      revenueView(read({ cycles: [cycle()], projects: [project({ cycle_id: A1 })] }), "project")
        .unbilled,
    ).toEqual([A1]);
    expect(markAllLabel(3)).toBe("Mark all 3 billed");
    expect(markAllLabel(1)).toBe("Mark 1 billed");
  });

  it("leaves out the lines with nothing to bill (No amount set, ₹0 Not billable), keeps held ones", () => {
    const nothing = {
      added_value: 0,
      added_count: 0,
      not_priced_count: 0,
      achieved: 0,
      remaining: 0,
    };
    const lines = read({
      cycles: [
        cycle(),
        // No amount set, nothing on top.
        cycle({ cycle_id: Y2, amount: null, potential: 0, ...nothing }),
        // ₹0 "Not billable", nothing on top.
        cycle({ project_id: P3, cycle_id: A2, amount: 0, potential: 0, ...nothing }),
      ],
      projects: [
        // On hold: its work so far can still be billed.
        project({ cycle_id: A1, held: true }),
        // A one-time project with no amount set.
        project({
          project_id: P4,
          cycle_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          amount: null,
          potential: 0,
        }),
      ],
    }).lines;
    expect(lines.map(hasSomethingToBill)).toEqual([true, false, false, true, false]);
    expect(unbilledCycleIds(lines)).toEqual([Y1, A1]);
    expect(markAllLabel(unbilledCycleIds(lines).length)).toBe("Mark all 2 billed");
  });

  it("a line with no amount of its own but priced work on top has something to bill", () => {
    const [line] = read({
      cycles: [cycle({ amount: null, potential: 2718, added_value: 2718 })],
      projects: [],
    }).lines;
    expect(hasSomethingToBill(line!)).toBe(true);
    expect(unbilledCycleIds([line!])).toEqual([Y1]);
    const [zero] = read({ cycles: [cycle({ amount: 0, potential: 500 })], projects: [] }).lines;
    expect(unbilledCycleIds([zero!])).toEqual([Y1]);
  });
});
