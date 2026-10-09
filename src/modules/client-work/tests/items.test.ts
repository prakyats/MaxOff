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
  stageChoices,
  weekEnd,
} from "../domain/items";
import { describeProjectActivity } from "../domain/activity";
import { cycleProgressWords, onTime, onTimeWords, sitLongest, sitWords } from "../domain/kpis";
import { cycleLabel, nextStartable, periodNext, periodStart } from "../domain/periods";
import { progressByClient, projectSummaries } from "../domain/projects";
import { movedNames, nameRows } from "../domain/positions";
import { activityPageSchema } from "../domain/schemas";
import type { Item, ItemStage, ItemState, Project } from "../domain/types";
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

describe("the progress line (decision 18, amendment D3)", () => {
  const states = (list: ItemState[]) => list.map((state) => ({ state }));

  it("counts done (approved in the same step) out of the items not closed and not carried out", () => {
    const progress = progressOf(
      states(["open", "done", "approved", "approved", "cancelled", "carried"]),
    );
    expect(progress).toEqual({ total: 4, done: 3, closed: 1 });
    expect(progressLine(progress)).toBe("3/4 done · 1 closed");
  });

  it("reads 'No items in this cycle.' when empty", () => {
    expect(progressLine(progressOf([]))).toBe("No items in this cycle.");
    expect(progressLine(progressOf(states(["open"])))).toBe("0/1 done");
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
    // The filters of before amendment D3 read as the open list.
    expect(parseItemFilter("done")).toBe("live");
    expect(matchesFilter({ state: "open", plannedDate: null }, "live", TODAY)).toBe(true);
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

  it("shows each working project's current cycle and progress, working ones first", () => {
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
        project({ id: "q", name: "Weekly reels", recurrence: "weekly" }),
      ],
      [
        {
          id: "c1",
          projectId: "p",
          clientId: "client",
          label: "October 2026",
          states: ["done", "open"],
        },
      ],
    );
    expect(summaries.map((summary) => [summary.id, summary.meta, summary.progress])).toEqual([
      ["p", "Monthly · October 2026", "1/2 done"],
      ["q", "Weekly · no current cycle", "No items in this cycle."],
      // A finished project has no current cycle: no progress line.
      ["done", "One-time · delivery 20 Oct", null],
    ]);
  });

  it("adds up each client's current cycles (Today's My clients)", () => {
    const sums = progressByClient([
      {
        id: "c1",
        projectId: "p",
        clientId: "k",
        label: null,
        states: ["done", "open", "cancelled"],
      },
      { id: "c2", projectId: "q", clientId: "k", label: null, states: ["approved", "carried"] },
      { id: "c3", projectId: "r", clientId: "m", label: null, states: [] },
    ]);
    expect(sums.get("k")).toEqual({ total: 3, done: 2, closed: 1 });
    expect(sums.get("m")).toEqual({ total: 0, done: 0, closed: 0 });
  });
});

function stage(over: Partial<ItemStage> = {}): ItemStage {
  return {
    id: "s1",
    itemId: "i1",
    projectId: "p1",
    name: "Script",
    position: "a0",
    archived: false,
    doneAt: null,
    doneBy: null,
    ...over,
  };
}

describe("an item's view (Q5 (b), decisions 7, 12, amendment D)", () => {
  const context = {
    today: TODAY,
    names: { r: "Ravi", o: "Prishit" },
    ownerId: "o",
    stages: [
      stage({ id: "s2", name: "Edit", position: "a1" }),
      stage({ doneAt: "2026-10-02T00:00:00Z", doneBy: "r" }),
      stage({ id: "sx", name: "Old", position: "a2", archived: true }),
      stage({ id: "so", itemId: "other", name: "Other's" }),
    ],
    lastChanges: {
      i1: { text: "ticked Script on Reel 1", by: "Ravi", at: "2026-10-02T00:00:00Z" },
    },
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

  it("shows a send-back, its own active stages in order with ticks, a carried-in mark", () => {
    const view = itemView(
      item({ carriedFromItemId: "x", originCycleId: "old", plannedDate: "2026-10-01" }),
      context,
    );
    expect(view.sentBack).toEqual({ verb: "Sent back", by: "Prishit", reason: "Wrong logo" });
    expect(view.stages).toEqual([
      { id: "s1", name: "Script", position: "a0", done: true },
      { id: "s2", name: "Edit", position: "a1", done: false },
    ]);
    expect(view.lastChange?.text).toBe("ticked Script on Reel 1");
    expect(view.carriedFrom).toBe("Carried from September");
    expect(view.planned?.overdue).toBe(true);
    expect(view.rules).toMatchObject({ ticks: true, markDone: true, reopen: false, editAll: true });
  });

  it("reads an Admin's reopen as Reopened", () => {
    const view = itemView(item(), {
      ...context,
      reviews: [{ ...context.reviews[0]!, reviewerId: "r", reason: "Not finished" }],
    });
    expect(view.sentBack).toEqual({ verb: "Reopened", by: "Ravi", reason: "Not finished" });
  });

  it("locks a done item to its title and notes; it is reopened, never ticked (D3)", () => {
    const view = itemView(
      item({
        state: "approved",
        doneAt: "2026-10-04T04:00:00Z",
        doneBy: "r",
        approvedAt: "2026-10-04T04:00:00Z",
        approvedBy: "r",
      }),
      context,
    );
    expect(view.rules).toEqual({
      ticks: false,
      markDone: false,
      reopen: true,
      cancel: false,
      editAll: false,
    });
    expect(view.stateLabel).toBe("Done");
    expect(view.sentBack).toBeNull();
    expect(view.history).toEqual(["Done by Ravi, 4 Oct"]);
  });

  it("keeps an approval made apart before amendment D3 in the history", () => {
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
    expect(view.history).toEqual(["Done by Ravi, 4 Oct", "Approved by Prishit, 5 Oct"]);
  });
});

describe("Tick ‹stage› on N and the line stages (amendment D2)", () => {
  it("offers the names the chosen items carry, each with the unticked stages of that name", () => {
    const choices = stageChoices([
      {
        stages: [
          { id: "a1", name: "Script", done: true },
          { id: "a2", name: "Edit", done: false },
        ],
      },
      { stages: [{ id: "b1", name: "edit", done: false }] },
      { stages: [] },
    ]);
    expect(choices).toEqual([{ name: "Edit", stageIds: ["a2", "b1"] }]);
  });

  it("edits a line's names as rows: keys ascend, a move reorders", () => {
    const rows = nameRows(["Script", "Shoot", "Edit"]);
    expect(rows.map((row) => row.id)).toEqual(["0", "1", "2"]);
    expect(rows[0]!.position < rows[1]!.position && rows[1]!.position < rows[2]!.position).toBe(
      true,
    );
    expect(movedNames(rows, "2", "0")).toEqual(["Edit", "Script", "Shoot"]);
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
    expect(cycleProgressWords({ total: 12, done: 9 })).toBe("9 of 12 done");
    expect(cycleProgressWords({ total: 0, done: 0 })).toBe("No current items");
  });

  it("where items sit longest: by each item's first unticked stage, the longest wait first", () => {
    const own = (itemId: string, ticked: string | null) => [
      stage({ id: `${itemId}1`, itemId, name: "Script", position: "a0", doneAt: ticked }),
      stage({ id: `${itemId}2`, itemId, name: "Edit", position: "a1" }),
      stage({ id: `${itemId}x`, itemId, name: "Old", position: "a2", archived: true }),
    ];
    const now = new Date("2026-10-08T06:30:00Z");
    const rows = sitLongest({
      items: [
        { id: "a", cycleId: "c", state: "open", createdAt: "2026-10-01T00:00:00Z" },
        { id: "b", cycleId: "c", state: "open", createdAt: "2026-10-01T00:00:00Z" },
        { id: "c", cycleId: "c", state: "approved", createdAt: "2026-10-01T00:00:00Z" },
        { id: "d", cycleId: "c", state: "open", createdAt: "2026-10-01T00:00:00Z" },
      ],
      stages: [...own("a", null), ...own("b", "2026-10-06T06:30:00Z"), ...own("c", null)],
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

  it("says amendment D's entries: a send-back, a reopen, an item's own stages, a line's stages", () => {
    expect(
      describeProjectActivity(entry({ action: "sent_back", meta: { reason: "Redo" } }), context),
    ).toMatchObject({ text: "sent back Reel 1", note: "Redo" });
    expect(
      describeProjectActivity(entry({ action: "reopened", meta: { reason: "Late fix" } }), context),
    ).toMatchObject({ text: "reopened Reel 1", note: "Late fix" });
    const own = (patch: Partial<Parameters<typeof describeProjectActivity>[0]>) =>
      describeProjectActivity(entry({ entity: "project_item_stage_list", ...patch }), context)
        ?.text;
    expect(own({ action: "insert", new: { name: "Colour" } })).toBe(
      "added the stage Colour to Reel 1",
    );
    expect(own({ action: "ticked", meta: { name: "Shoot" } })).toBe("ticked Shoot on Reel 1");
    expect(own({ action: "unticked", meta: { name: "Shoot" } })).toBe("unticked Shoot on Reel 1");
    expect(own({ action: "archived", meta: { name: "Shoot" } })).toBe(
      "removed the stage Shoot from Reel 1",
    );
    expect(
      own({ action: "update", meta: { name: "Cut" }, old: { name: "Cut" }, new: { name: "Edit" } }),
    ).toBe("renamed the stage Cut to Edit on Reel 1");
    expect(own({ action: "update", meta: { name: "Edit" }, new: { position: "b" } })).toBe(
      "moved the stage Edit on Reel 1",
    );
    expect(
      describeProjectActivity(
        entry({
          entity: "project_item_blueprints",
          entityId: "p",
          old: { stages: [] },
          new: { stages: ["Shoot", "Post"] },
        }),
        context,
      )?.text,
    ).toBe("set the stages of an item list line: Shoot, Post");
    expect(
      describeProjectActivity(
        entry({
          entity: "project_stages",
          entityId: "p",
          action: "insert",
          new: { name: "Caption" },
        }),
        context,
      )?.text,
    ).toBe("added the default stage Caption");
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

describe("the activity panel's page query", () => {
  const project = "00000000-0000-4000-8000-000000000001";

  it("defaults to the newest page of everything, and takes a whole cursor", () => {
    expect(activityPageSchema.parse({ projectId: project, itemId: null })).toEqual({
      projectId: project,
      kind: "all",
      itemId: null,
      beforeAt: null,
      beforeId: null,
    });
    expect(
      activityPageSchema.parse({
        projectId: project,
        kind: "stages",
        beforeAt: "2026-10-09T05:00:00+00:00",
        beforeId: "42",
      }).beforeId,
    ).toBe(42);
  });

  it("refuses an unknown chip and half a cursor", () => {
    expect(activityPageSchema.safeParse({ projectId: project, kind: "tasks" }).success).toBe(false);
    expect(
      activityPageSchema.safeParse({ projectId: project, beforeAt: "2026-10-09T05:00:00Z" })
        .success,
    ).toBe(false);
  });
});
