import { describe, expect, it } from "vitest";

import {
  carriedFromLabel,
  currentCycle,
  dueThisWeek,
  groupByAdmin,
  isOverdue,
  matchesFilter,
  parseItemFilter,
  plannedLine,
  progressLine,
  progressOf,
  weekEnd,
} from "../domain/items";
import { describeProjectActivity } from "../domain/activity";
import { cycleProgressWords, onTime, onTimeWords, sitLongest, sitWords } from "../domain/kpis";
import { cycleLabel, nextStartable, periodNext, periodStart } from "../domain/periods";
import { projectSummaries } from "../domain/projects";
import type { Item, ItemState, Project } from "../domain/types";
import { itemView } from "../domain/views";

const TODAY = "2026-10-08"; // a Thursday

function item(over: Partial<Item> = {}): Item {
  return {
    id: "i1",
    projectId: "p1",
    cycleId: "c1",
    title: "Reel 1",
    position: "a0",
    plannedDate: null,
    notes: null,
    customFields: {},
    state: "open",
    doneAt: null,
    doneBy: null,
    approvedAt: null,
    approvedBy: null,
    cancelledReason: null,
    carryDecision: null,
    carriedFromItemId: null,
    originCycleId: "c1",
    createdAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("overdue and due this week (decision 10, 19)", () => {
  it("is overdue only while open with a planned date before today", () => {
    expect(isOverdue({ state: "open", plannedDate: "2026-10-07" }, TODAY)).toBe(true);
    expect(isOverdue({ state: "open", plannedDate: TODAY }, TODAY)).toBe(false);
    expect(isOverdue({ state: "done", plannedDate: "2026-10-01" }, TODAY)).toBe(false);
    expect(isOverdue({ state: "open", plannedDate: null }, TODAY)).toBe(false);
  });

  it("ends the week on Sunday", () => {
    expect(weekEnd(TODAY)).toBe("2026-10-11");
    expect(weekEnd("2026-10-11")).toBe("2026-10-11");
    expect(weekEnd("2026-10-12")).toBe("2026-10-18");
  });

  it("lists open items overdue or due by Sunday, oldest first", () => {
    const rows = dueThisWeek(
      [
        item({ id: "a", title: "Late", plannedDate: "2026-10-01" }),
        item({ id: "b", title: "Sunday", plannedDate: "2026-10-11" }),
        item({ id: "c", title: "Next week", plannedDate: "2026-10-12" }),
        item({ id: "d", title: "No date" }),
        item({ id: "e", title: "Done", plannedDate: "2026-10-09", state: "done" }),
      ],
      TODAY,
    );
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("words the planned date", () => {
    expect(plannedLine({ state: "open", plannedDate: "2026-10-06" }, TODAY)).toEqual({
      text: "Overdue · 6 Oct",
      overdue: true,
    });
    expect(plannedLine({ state: "open", plannedDate: TODAY }, TODAY)?.text).toBe("Due today");
    expect(plannedLine({ state: "open", plannedDate: "2026-10-10" }, TODAY)?.text).toBe(
      "Planned 10 Oct",
    );
    expect(plannedLine({ state: "open", plannedDate: null }, TODAY)).toBeNull();
  });
});

describe("the progress line (decision 18)", () => {
  const states = (list: ItemState[]) => list.map((state) => ({ state }));

  it("counts done and approved out of the items not closed and not carried out", () => {
    const progress = progressOf(
      states(["open", "done", "approved", "approved", "cancelled", "carried"]),
    );
    expect(progress).toEqual({ total: 4, done: 3, approved: 2, closed: 1 });
    expect(progressLine(progress)).toBe("3/4 done · 2/4 approved · 1 closed");
  });

  it("reads 'No items in this cycle.' when empty", () => {
    expect(progressLine(progressOf([]))).toBe("No items in this cycle.");
    expect(progressLine(progressOf(states(["open"])))).toBe("0/1 done · 0/1 approved");
  });
});

describe("carried from (decision 12, 26)", () => {
  it("drops the year when it is the cycle's", () => {
    expect(carriedFromLabel("September 2026", "October 2026")).toBe("Carried from September");
    expect(carriedFromLabel("December 2025", "January 2026")).toBe("Carried from December 2025");
    expect(carriedFromLabel("28 Sep–4 Oct 2026", "5–11 Oct 2026")).toBe(
      "Carried from 28 Sep–4 Oct",
    );
    expect(carriedFromLabel(null, "October 2026")).toBe("Carried forward");
  });
});

describe("cycles", () => {
  it("opens on the running cycle, else the latest begun", () => {
    const cycles = [
      { id: "s", periodStart: "2026-09-01", periodEnd: "2026-09-30" },
      { id: "o", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
      { id: "n", periodStart: "2026-11-01", periodEnd: "2026-11-30" },
    ];
    expect(currentCycle(cycles, TODAY)?.id).toBe("o");
    expect(currentCycle([cycles[0]!, cycles[2]!], TODAY)?.id).toBe("s");
    expect(currentCycle([{ id: "x", periodStart: null, periodEnd: null }], TODAY)?.id).toBe("x");
    expect(currentCycle([], TODAY)).toBeNull();
  });

  it("computes periods and labels as the database does", () => {
    expect(periodStart("weekly", TODAY)).toBe("2026-10-05");
    expect(periodStart("weekly", "2026-10-11")).toBe("2026-10-05");
    expect(periodStart("monthly", TODAY)).toBe("2026-10-01");
    expect(periodNext("monthly", "2026-12-01")).toBe("2027-01-01");
    expect(cycleLabel("monthly", "2026-11-01")).toBe("November 2026");
    expect(cycleLabel("weekly", "2026-10-05")).toBe("5–11 Oct 2026");
    expect(cycleLabel("weekly", "2026-09-28")).toBe("28 Sep–4 Oct 2026");
    expect(cycleLabel("weekly", "2026-12-28")).toBe("28 Dec 2026–3 Jan 2027");
  });

  it("offers the next period at most 7 days ahead, once (decision 3)", () => {
    expect(nextStartable("weekly", TODAY, [])).toEqual({
      start: "2026-10-12",
      label: "12–18 Oct 2026",
    });
    expect(nextStartable("weekly", TODAY, ["2026-10-12"])).toBeNull();
    expect(nextStartable("monthly", TODAY, [])).toBeNull();
    expect(nextStartable("monthly", "2026-10-25", [])).toEqual({
      start: "2026-11-01",
      label: "November 2026",
    });
    expect(nextStartable("one_time", TODAY, [])).toBeNull();
  });
});

describe("the cross-client list", () => {
  it("reads its filter from the address, overdue for E1's link", () => {
    expect(parseItemFilter("overdue")).toBe("overdue");
    expect(parseItemFilter(undefined)).toBe("live");
    expect(parseItemFilter("bogus")).toBe("live");
    expect(matchesFilter({ state: "done", plannedDate: null }, "live", TODAY)).toBe(true);
    expect(matchesFilter({ state: "approved", plannedDate: null }, "live", TODAY)).toBe(false);
    expect(matchesFilter({ state: "open", plannedDate: "2026-10-01" }, "overdue", TODAY)).toBe(
      true,
    );
  });

  it("groups the Owner's view by Admin, his own clients last (amendment C E1)", () => {
    const groups = groupByAdmin(
      [{ adminId: null }, { adminId: "r" }, { adminId: "a" }, { adminId: "r" }],
      { r: "Ravi", a: "Asha" },
    );
    expect(groups.map((group) => [group.name, group.rows.length])).toEqual([
      ["Asha", 1],
      ["Ravi", 2],
      ["No Admin (yours)", 1],
    ]);
  });
});

describe("the Projects tab", () => {
  const project = (over: Partial<Project>): Project => ({
    id: "p",
    clientId: "c",
    name: "Monthly reels",
    description: null,
    recurrence: "monthly",
    state: "in_progress",
    deliveryDate: null,
    customFields: {},
    templateId: null,
    createdBy: "m",
    createdAt: "2026-10-01T00:00:00Z",
    cancelledReason: null,
    ...over,
  });

  it("shows each project's current cycle and progress, working ones first", () => {
    const summaries = projectSummaries(
      [
        project({
          id: "done",
          name: "Brand film",
          recurrence: "one_time",
          state: "completed",
          deliveryDate: "2026-10-20",
        }),
        project({ id: "p" }),
      ],
      [
        {
          id: "c1",
          projectId: "p",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          label: "October 2026",
          state: "open",
        },
        {
          id: "c2",
          projectId: "done",
          periodStart: null,
          periodEnd: null,
          label: null,
          state: "open",
        },
      ],
      [
        { cycleId: "c1", state: "done" },
        { cycleId: "c1", state: "open" },
        { cycleId: "c2", state: "approved" },
      ],
      TODAY,
    );
    expect(summaries.map((summary) => [summary.id, summary.meta, summary.progress])).toEqual([
      ["p", "Monthly · October 2026", "1/2 done · 0/2 approved"],
      ["done", "One-time · delivery 20 Oct", "1/1 done · 1/1 approved"],
    ]);
  });
});

describe("an item's view (Q5 (b), decisions 6, 7, 12)", () => {
  const context = {
    today: TODAY,
    names: { r: "Ravi", o: "Prishit" },
    ticks: [{ itemId: "i1", stageId: "s1", doneAt: "2026-10-02T00:00:00Z", doneBy: "r" }],
    reviews: [
      {
        itemId: "i1",
        decision: "rejected" as const,
        reason: "Wrong logo",
        reviewerId: "o",
        at: "2026-10-03T00:00:00Z",
      },
    ],
    cycleLabels: { old: "September 2026" },
    cycleLabel: "October 2026",
  };

  it("shows a sent-back reason, the ticks and a carried-in mark", () => {
    const view = itemView(
      item({ carriedFromItemId: "x", originCycleId: "old", plannedDate: "2026-10-01" }),
      context,
    );
    expect(view.sentBack).toEqual({ by: "Prishit", reason: "Wrong logo" });
    expect(view.ticked).toEqual(["s1"]);
    expect(view.carriedFrom).toBe("Carried from September");
    expect(view.planned?.overdue).toBe(true);
    expect(view.rules).toMatchObject({ ticks: true, markDone: true, decide: false, editAll: true });
  });

  it("locks an approved item to its title and notes", () => {
    const view = itemView(
      item({
        state: "approved",
        doneAt: "2026-10-04T04:00:00Z",
        doneBy: "r",
        approvedAt: "2026-10-05T04:00:00Z",
        approvedBy: "o",
      }),
      context,
    );
    expect(view.rules).toEqual({
      ticks: false,
      markDone: false,
      notDone: false,
      decide: false,
      cancel: false,
      editAll: false,
    });
    expect(view.sentBack).toBeNull();
    expect(view.history).toEqual(["Done by Ravi, 4 Oct", "Approved by Prishit, 5 Oct"]);
  });
});

describe("the item KPIs (7.4, PRODUCT §4.13)", () => {
  it("On time: approved on or before the planned date, of the items planned in the period", () => {
    const period = { from: "2026-10-01", to: "2026-10-31" };
    const result = onTime(
      [
        { plannedDate: "2026-10-05", state: "approved", approvedAt: "2026-10-05T12:00:00Z" },
        { plannedDate: "2026-10-05", state: "approved", approvedAt: "2026-10-06T12:00:00Z" },
        { plannedDate: "2026-10-10", state: "open", approvedAt: null },
        { plannedDate: "2026-10-10", state: "cancelled", approvedAt: null },
        { plannedDate: "2026-09-30", state: "approved", approvedAt: "2026-09-29T12:00:00Z" },
        { plannedDate: null, state: "approved", approvedAt: "2026-10-02T12:00:00Z" },
      ],
      period,
    );
    expect(result).toEqual({ onTime: 1, planned: 3 });
    expect(onTimeWords(result)).toBe("1 of 3 on time (33%)");
    expect(onTimeWords({ onTime: 0, planned: 0 })).toBe("Nothing planned");
  });

  it("Cycle progress in words", () => {
    expect(cycleProgressWords({ total: 12, done: 9, approved: 8 })).toBe(
      "9 of 12 done · 8 of 9 approved",
    );
    expect(cycleProgressWords({ total: 0, done: 0, approved: 0 })).toBe("No current items");
  });

  it("where items sit longest: by the first unticked stage, the longest wait first", () => {
    const stages = [
      { id: "s1", projectId: "p", name: "Script", position: "a0", archived: false },
      { id: "s2", projectId: "p", name: "Edit", position: "a1", archived: false },
      { id: "sx", projectId: "p", name: "Old", position: "a2", archived: true },
    ];
    const now = new Date("2026-10-08T06:30:00Z");
    const rows = sitLongest({
      items: [
        { id: "a", projectId: "p", cycleId: "c", state: "open", createdAt: "2026-10-01T00:00:00Z" },
        { id: "b", projectId: "p", cycleId: "c", state: "open", createdAt: "2026-10-01T00:00:00Z" },
        { id: "c", projectId: "p", cycleId: "c", state: "done", createdAt: "2026-10-01T00:00:00Z" },
        { id: "d", projectId: "q", cycleId: "c", state: "open", createdAt: "2026-10-01T00:00:00Z" },
      ],
      stages,
      ticks: [{ itemId: "b", stageId: "s1", doneAt: "2026-10-06T06:30:00Z", doneBy: null }],
      cycles: [{ id: "c", periodStart: "2026-10-01" }],
      now,
    });
    expect(rows.map((row) => [row.stage, row.count, Math.round(row.medianDays)])).toEqual([
      ["Script", 1, 8],
      ["Edit", 1, 2],
    ]);
    expect(sitWords({ stage: "Edit", count: 8, medianDays: 3 })).toBe(
      "8 waiting at Edit · median 3 days",
    );
  });
});

describe("the project's history (7A notes for 7B (a))", () => {
  const context = {
    names: { r: "Ravi" },
    items: { i1: "Reel 1" },
    stages: { s1: "Edit" },
  };
  const entry = (patch: Partial<Parameters<typeof describeProjectActivity>[0]>) => ({
    id: 1,
    actorId: "r",
    entity: "project_items",
    entityId: "i1",
    action: "update",
    old: {},
    new: {},
    meta: {},
    at: "2026-10-08T05:00:00Z",
    ...patch,
  });

  it("describes the client-work actions", () => {
    expect(describeProjectActivity(entry({ action: "done" }), context)?.text).toBe(
      "marked Reel 1 done",
    );
    expect(
      describeProjectActivity(
        entry({ action: "rejected", meta: { reason: "Wrong logo" } }),
        context,
      ),
    ).toMatchObject({ text: "sent back Reel 1", note: "Wrong logo" });
    expect(
      describeProjectActivity(
        entry({ entity: "project_item_stages", action: "ticked", meta: { stage_id: "s1" } }),
        context,
      )?.text,
    ).toBe("ticked Edit on Reel 1");
    expect(
      describeProjectActivity(
        entry({ entity: "projects", entityId: "p", action: "completed", actorId: null }),
        { ...context, projects: { p: "Monthly reels" } },
      ),
    ).toMatchObject({ actor: "MaxOff", text: "completed the project Monthly reels" });
    expect(
      describeProjectActivity(
        entry({
          entity: "project_cycles",
          entityId: "p",
          action: "generated",
          new: { label: "October 2026" },
        }),
        context,
      )?.text,
    ).toBe("started October 2026");
  });

  it("skips the internal keys, and an entry that changed only those says nothing", () => {
    expect(
      describeProjectActivity(
        entry({ new: { overdue_armed_at: "x", reopened_at: "y", updated_at: "z" } }),
        context,
      ),
    ).toBeNull();
    expect(
      describeProjectActivity(
        entry({ new: { planned_date: "2026-10-10", overdue_armed_at: "x" } }),
        context,
      )?.text,
    ).toBe("planned Reel 1 for 10 Oct");
    expect(
      describeProjectActivity(
        entry({ entity: "projects", entityId: "p", new: { delivery_armed_at: "x" } }),
        context,
      ),
    ).toBeNull();
    expect(
      describeProjectActivity(
        entry({ entity: "project_cycles", entityId: "p", new: { ready_armed_at: "x" } }),
        context,
      ),
    ).toBeNull();
  });
});
