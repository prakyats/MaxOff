import { describe, expect, it } from "vitest";

import type { MonthCloseRead, WaitingList } from "../domain/month-close";
import {
  changeRows,
  claimsLine,
  closeButtonLabel,
  closedLine,
  closeLink,
  monthCloseView,
  noteProblem,
  parseCloseMonth,
  totalRows,
  versionRows,
  waitingRows,
} from "../domain/month-close-view";

const SEPT = "2026-09-01";

const waiting = (counts: Partial<WaitingList> = {}): WaitingList => ({
  attendance: 0,
  leave: 0,
  leavingEarly: 0,
  extraWork: 0,
  expenseClaims: 0,
  openWork: 0,
  carryDecisions: 0,
  noAmount: 0,
  readyToComplete: 0,
  total: 0,
  claimsUntil: "2026-10-05",
  claimsOpen: false,
  ...counts,
});

const read = (over: Partial<MonthCloseRead>): MonthCloseRead => ({
  month: SEPT,
  monthName: "September 2026",
  closed: false,
  canClose: true,
  cannotClose: null,
  waiting: waiting(),
  latest: null,
  versions: [],
  changedSinceClose: null,
  ...over,
});

const v1 = {
  id: "v1",
  version: 1,
  // 3 Oct 2026, 10:00 IST.
  closedAt: "2026-10-03T04:30:00+00:00",
  closedById: "o",
  closedByName: "Asha",
  correctsId: null,
  note: null,
};
const v2 = {
  ...v1,
  id: "v2",
  version: 2,
  closedAt: "2026-10-05T04:30:00+00:00",
  correctsId: "v1",
  note: "Reel 3 was reopened after the close.",
};

describe("the close screen's address", () => {
  it("takes YYYY-MM and nothing else", () => {
    expect(parseCloseMonth("2026-09")).toBe(SEPT);
    expect(parseCloseMonth("2026-13")).toBeNull();
    expect(parseCloseMonth("2026-09-01")).toBeNull();
    expect(parseCloseMonth(undefined)).toBeNull();
  });
});

describe("the waiting list", () => {
  it("lists only the kinds with something waiting, in §7.2's order, each with where to settle it", () => {
    const rows = waitingRows(
      waiting({ readyToComplete: 1, attendance: 3, carryDecisions: 2, noAmount: 1, total: 7 }),
      SEPT,
    );
    expect(rows.map((row) => [row.label, row.count, row.href])).toEqual([
      ["Attendance", 3, "/approvals"],
      ["Carry decisions", 2, "/clients/items/decide"],
      ["No amount set", 1, "/reports/revenue?month=2026-09"],
      ["Ready to complete", 1, "/reports/revenue?month=2026-09"],
    ]);
    expect(rows.every((row) => row.meaning.endsWith("."))).toBe(true);
  });

  it("words the button by the total (decision 16)", () => {
    expect(closeButtonLabel(SEPT, 0)).toBe("Close September");
    expect(closeButtonLabel(SEPT, 1)).toBe("Close September with 1 thing still waiting");
    expect(closeButtonLabel(SEPT, 4)).toBe("Close September with 4 things still waiting");
  });

  it("says the expense claims line only until the 5th", () => {
    expect(claimsLine(waiting({ claimsOpen: true }), SEPT)).toBe(
      "Expense claims for September can still be added until 5 Oct.",
    );
    expect(claimsLine(waiting({ claimsOpen: false }), SEPT)).toBeNull();
  });
});

describe("the screen's state", () => {
  it("an open month: the rows, the claims line and the button", () => {
    const view = monthCloseView(
      read({ waiting: waiting({ leave: 2, expenseClaims: 2, total: 4, claimsOpen: true }) }),
    );
    expect(view.state).toBe("open");
    if (view.state !== "open") return;
    expect(view.button).toBe("Close September with 4 things still waiting");
    expect(view.waiting.map((row) => row.key)).toEqual(["leave", "expenseClaims"]);
    expect(view.claims).toMatch(/until 5 Oct\.$/);
  });

  it("a month that cannot be closed gives the function's reason and no button", () => {
    const view = monthCloseView(
      read({
        canClose: false,
        waiting: null,
        cannotClose: { reason: "nothing_to_close", message: "Nothing to close." },
      }),
    );
    expect(view).toEqual({ state: "cannot", message: "Nothing to close." });
    const notEnded = monthCloseView(
      read({
        canClose: false,
        cannotClose: { reason: "not_ended", message: "November 2026 hasn't ended yet." },
      }),
    );
    expect(notEnded).toEqual({ state: "cannot", message: "November 2026 hasn't ended yet." });
  });

  it("a closed month: Closed 3 Oct · v2, the versions newest first, the next version", () => {
    const view = monthCloseView(
      read({
        closed: true,
        canClose: false,
        waiting: null,
        cannotClose: { reason: "closed", message: "September 2026 is already closed." },
        versions: [v1, v2],
        changedSinceClose: { lines: [], totals: [] },
      }),
    );
    expect(view.state).toBe("closed");
    if (view.state !== "closed") return;
    expect(view.closed).toBe("Closed 3 Oct · v2");
    expect(view.nextVersion).toBe(3);
    expect(view.versions).toEqual([
      {
        id: "v2",
        title: "v2 · Corrected 5 Oct",
        note: "Corrected: Reel 3 was reopened after the close.",
        by: "By Asha",
      },
      { id: "v1", title: "v1 · Closed 3 Oct", note: null, by: "By Asha" },
    ]);
  });

  it("the Revenue header's link: no link before the first priced month (Nothing to close.)", () => {
    expect(closeLink("2026-08-01", [], SEPT)).toBeNull();
    expect(closeLink(SEPT, [], null)).toBeNull();
    // A closed month keeps its link whatever the first priced month says now.
    expect(closeLink("2026-08-01", [v1], SEPT)?.label).toBe("Closed 3 Oct · v1");
    expect(closeLink("2026-08-01", [v1], null)?.closed).toBe(true);
  });

  it("the Revenue header's link: Close month, or Closed 3 Oct · v1", () => {
    expect(closeLink(SEPT, [], SEPT)).toEqual({
      href: "/reports/close/2026-09",
      label: "Close month",
      closed: false,
    });
    expect(closeLink(SEPT, [], "2026-08-01")?.label).toBe("Close month");
    expect(closeLink(SEPT, [v1], SEPT)).toEqual({
      href: "/reports/close/2026-09",
      label: "Closed 3 Oct · v1",
      closed: true,
    });
    expect(closedLine([])).toBeNull();
    expect(versionRows([{ ...v1, closedByName: null }])[0]?.by).toBeNull();
  });
});

describe("Changed since close in words", () => {
  it("a reopened deliverable names who did it, in rupees before → after", () => {
    const [row] = changeRows([
      {
        kind: "changed",
        line: "item",
        id: "i3",
        cycleId: "c1",
        what: "Reel 3 · Monthly posts",
        before: { value: 5000, achieved: true, in_potential: true, closed_not_achieved: false },
        after: { value: 5000, achieved: false, in_potential: true, closed_not_achieved: false },
        cause: { action: "reopened", byId: "a", byName: "Ravi", at: "2026-10-04T05:00:00Z" },
      },
    ]);
    expect(row).toEqual({
      key: "item:i3",
      what: "Reel 3 · Monthly posts",
      detail: "Reopened by Ravi",
      figures: ["Achieved ₹5,000 → ₹0"],
    });
  });

  it("a line with no cause whose amount stayed says Figures changed, with no name, and only the figures that moved", () => {
    const [row] = changeRows([
      {
        kind: "changed",
        line: "cycle",
        id: "c1",
        cycleId: null,
        what: "Monthly posts · First client · September 2026",
        before: {
          amount: 30000,
          potential: 30000,
          achieved: 10000,
          remaining: 20000,
          closed_not_achieved: 0,
        },
        after: {
          amount: 30000,
          potential: 30000,
          achieved: 5000,
          remaining: 25000,
          closed_not_achieved: 0,
        },
        cause: null,
      },
    ]);
    expect(row?.detail).toBe("Figures changed");
    expect(row?.figures).toEqual(["Achieved ₹10,000 → ₹5,000", "Remaining ₹20,000 → ₹25,000"]);
  });

  it("a line whose own amount moved says Amount changed (a cycle, an advance)", () => {
    const figures = { potential: 30000, achieved: 0, remaining: 30000, closed_not_achieved: 0 };
    const rows = changeRows([
      {
        kind: "changed",
        line: "cycle",
        id: "c2",
        cycleId: null,
        what: "Monthly posts · First client · October 2026",
        before: { amount: 30000, ...figures },
        after: { amount: 35000, ...figures, potential: 35000, remaining: 35000 },
        cause: null,
      },
      {
        kind: "changed",
        line: "advance_received",
        id: "a2",
        cycleId: null,
        what: "Advance received · Launch film",
        before: { amount: 20000 },
        after: { amount: 25000 },
        cause: null,
      },
    ]);
    expect(rows.map((row) => row.detail)).toEqual(["Amount changed", "Amount changed"]);
  });

  it("an added line, a removed advance, an unpriced value and the totals", () => {
    const rows = changeRows([
      {
        kind: "added",
        line: "project",
        id: "p9",
        cycleId: null,
        what: "Launch film · First client",
        before: null,
        after: { amount: null, potential: 0, achieved: 0, remaining: 0, closed_not_achieved: 0 },
        cause: null,
      },
      {
        kind: "removed",
        line: "advance_received",
        id: "a1",
        cycleId: null,
        what: "Advance received · Launch film",
        before: { amount: 20000 },
        after: null,
        cause: null,
      },
      {
        kind: "changed",
        line: "item",
        id: "i4",
        cycleId: "c1",
        what: "Extra · Monthly posts",
        before: { value: null, achieved: false, in_potential: false, closed_not_achieved: false },
        after: { value: 2718, achieved: false, in_potential: true, closed_not_achieved: false },
        cause: null,
      },
    ]);
    expect(rows.map((row) => [row.detail, row.figures])).toEqual([
      ["Added since the close", ["Amount No amount set", "Potential ₹0"]],
      ["No longer in the month", ["Received was ₹20,000"]],
      ["Amount changed", ["Value Not priced → ₹2,718", "Now in Potential"]],
    ]);
    expect(totalRows([{ key: "achieved", before: 10000, after: 5000 }])).toEqual([
      { key: "achieved", text: "Achieved ₹10,000 → ₹5,000" },
    ]);
  });
});

describe("the correction note", () => {
  it("is 10 to 500 characters, trimmed, said in the function's words", () => {
    expect(noteProblem("   short   ")).toBe("Write a note of 10 to 500 characters.");
    expect(noteProblem("1234567890")).toBeNull();
    expect(noteProblem(`  ${"x".repeat(500)}  `)).toBeNull();
    expect(noteProblem("x".repeat(501))).toBe("Write a note of 10 to 500 characters.");
  });
});
