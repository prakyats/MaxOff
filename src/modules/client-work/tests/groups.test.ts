import { describe, expect, it } from "vitest";

import {
  describeActivityLines,
  describeProjectActivity,
  type ActivityEntry,
} from "../domain/activity";
import { activeStages, stageChoices } from "../domain/items";
import { sitLongest } from "../domain/kpis";
import {
  addItemStageSchema,
  createGroupedProjectSchema,
  STAGES_MAX,
  updateBlueprintSchema,
  updateItemStageGroupSchema,
} from "../domain/schemas";
import type { ItemStage } from "../domain/types";
import { stageGroupViews, type ItemStageView } from "../domain/views";

/**
 * Stage groups and deliverables (6b Release 1, DATA-MODEL §5b): the order the screens draw, the
 * groups with their own "n/m", "Group · Stage" in the bulk tick and the history, and the rules
 * the actions check first. Neutral names only: nothing is pre-defined.
 */

const CLIENT = "00000000-0000-4000-8000-000000000001";

function row(over: Partial<ItemStageView> & Pick<ItemStageView, "id" | "name">): ItemStageView {
  return { position: "a0", groupLabel: null, groupPosition: null, done: false, ...over };
}

function stage(over: Partial<ItemStage> & Pick<ItemStage, "id" | "name">): ItemStage {
  return {
    itemId: "i1",
    projectId: "p1",
    position: "a0",
    groupLabel: null,
    groupPosition: null,
    archived: false,
    doneAt: null,
    doneBy: null,
    ...over,
  };
}

describe("the order and the groups (6b)", () => {
  it("puts the untitled group first, then the groups by their key, each by place", () => {
    const ordered = activeStages([
      stage({ id: "b2", name: "Two", groupLabel: "Phase B", groupPosition: "b", position: "b" }),
      stage({ id: "u1", name: "Old", position: "z" }),
      stage({ id: "a1", name: "One", groupLabel: "Phase A", groupPosition: "a", position: "m" }),
      stage({ id: "b1", name: "One", groupLabel: "Phase B", groupPosition: "b", position: "a" }),
      stage({ id: "gone", name: "Gone", archived: true }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["u1", "a1", "b1", "b2"]);
  });

  it("reads a list from before groups as one untitled group with its own count", () => {
    const groups = stageGroupViews([
      row({ id: "1", name: "One", position: "a", done: true }),
      row({ id: "2", name: "Two", position: "b" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: null, done: 1 });
    expect(groups[0]?.stages.map((s) => s.id)).toEqual(["1", "2"]);
  });

  it("counts each named group on its own", () => {
    const groups = stageGroupViews([
      row({ id: "1", name: "One", groupLabel: "Phase A", groupPosition: "a", done: true }),
      row({ id: "2", name: "One", groupLabel: "Phase B", groupPosition: "b" }),
      row({ id: "3", name: "Two", groupLabel: "Phase B", groupPosition: "b", position: "b" }),
    ]);
    expect(groups.map((g) => [g.label, g.done, g.stages.length])).toEqual([
      ["Phase A", 1, 1],
      ["Phase B", 0, 2],
    ]);
  });
});

describe("Tick ‹stage› on N with groups (6b)", () => {
  it("names a stage in a named group 'Group · Stage' and ticks that group's stage per item", () => {
    const choices = stageChoices([
      {
        stages: [
          { id: "a1", name: "Edit", done: false, groupLabel: "Phase A" },
          { id: "a2", name: "Edit", done: false, groupLabel: "Phase B" },
          { id: "a3", name: "Check", done: false, groupLabel: null },
        ],
      },
      {
        stages: [
          { id: "b1", name: "edit", done: false, groupLabel: "phase a" },
          { id: "b3", name: "Check", done: false },
        ],
      },
    ]);
    expect(choices).toEqual([
      { name: "Phase A · Edit", stageIds: ["a1", "b1"] },
      { name: "Phase B · Edit", stageIds: ["a2"] },
      { name: "Check", stageIds: ["a3", "b3"] },
    ]);
  });

  it("keeps the same name in two groups apart where an item waits longest", () => {
    const rows = sitLongest({
      items: [
        { id: "i1", cycleId: "c", state: "open", createdAt: "2026-10-01T00:00:00Z" },
        { id: "i2", cycleId: "c", state: "open", createdAt: "2026-10-01T00:00:00Z" },
      ],
      stages: [
        stage({ id: "1", itemId: "i1", name: "Edit", groupLabel: "Phase A", groupPosition: "a" }),
        stage({ id: "2", itemId: "i2", name: "Edit", groupLabel: "Phase B", groupPosition: "b" }),
      ],
      cycles: [{ id: "c", periodStart: null }],
      now: new Date("2026-10-03T00:00:00Z"),
    });
    expect(rows.map((r) => r.stage).sort()).toEqual(["Phase A · Edit", "Phase B · Edit"]);
  });
});

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 1,
    actorId: "r",
    entity: "project_stages",
    entityId: "s1",
    action: "update",
    old: {},
    new: {},
    meta: {},
    at: "2026-10-15T10:00:00Z",
    ...over,
  };
}

const context = { names: { r: "Ravi" }, items: { s1: "Item 1" }, stages: {} };
const say = (over: Partial<ActivityEntry>) => describeProjectActivity(entry(over), context)?.text;

describe("the history of stage groups (6b)", () => {
  it("says a default stage in a group as 'Group · Stage'", () => {
    expect(say({ action: "insert", new: { name: "Shoot", group_label: "Phase A" } })).toBe(
      "added the default stage Phase A · Shoot",
    );
    expect(say({ action: "insert", new: { name: "Shoot", group_label: null } })).toBe(
      "added the default stage Shoot",
    );
    expect(
      say({ action: "archived", old: { name: "Shoot", group_label: "Phase A" }, new: {} }),
    ).toBe("removed the default stage Phase A · Shoot");
  });

  it("says a group's own change: named, renamed, its name taken off, moved", () => {
    expect(say({ action: "group_renamed", meta: { group: null, to: "Phase A" } })).toBe(
      "named the default stage group Phase A",
    );
    expect(say({ action: "group_renamed", meta: { group: "Phase A", to: "Phase C" } })).toBe(
      "renamed the default stage group Phase A to Phase C",
    );
    expect(say({ action: "group_renamed", meta: { group: "Phase A", to: null } })).toBe(
      "took the name off the default stage group Phase A",
    );
    expect(say({ action: "group_moved", meta: { group: "Phase A", to: null } })).toBe(
      "moved the default stage group Phase A",
    );
    expect(
      say({
        entity: "project_item_stage_list",
        action: "group_moved",
        meta: { group: "Phase B" },
      }),
    ).toBe("moved the stage group Phase B on Item 1");
  });

  it("says one group rename once, however many stage rows it wrote", () => {
    const rename = (id: number, stage: string) =>
      entry({
        id,
        entityId: stage,
        action: "group_renamed",
        meta: { group: "Phase A", to: "Phase C", name: stage },
      });
    const lines = describeActivityLines(
      [
        rename(3, "s3"),
        rename(2, "s2"),
        rename(1, "s1"),
        entry({ id: 0, action: "insert", new: { name: "One" } }),
      ],
      context,
    );
    expect(lines.map((line) => line.text)).toEqual([
      "renamed the default stage group Phase A to Phase C",
      "added the default stage One",
    ]);
  });

  it("says a stage moved into another group, on a deliverable too", () => {
    expect(
      say({
        old: { group_label: null, name: "Shoot" },
        new: { group_label: "Phase B", position: "a" },
      }),
    ).toBe("moved the default stage Shoot into the group Phase B");
    expect(
      say({
        entity: "project_item_stage_list",
        action: "ticked",
        meta: { name: "Shoot" },
        old: { group_label: "Phase A" },
      }),
    ).toBe("ticked Phase A · Shoot on Item 1");
    expect(
      say({
        entity: "project_item_stage_list",
        action: "update",
        old: { name: "Cut" },
        new: { name: "Trim" },
        meta: {},
      }),
    ).toBe("renamed the stage Cut to Trim on Item 1");
  });

  it("says a line's groups", () => {
    expect(
      say({
        entity: "project_item_blueprints",
        old: { title: "Item" },
        new: {
          stage_groups: [
            { label: "Phase A", stages: ["One", "Two"] },
            { label: "Phase B", stages: ["Three"] },
          ],
          stages: ["One", "Two", "Three"],
        },
      }),
    ).toBe("set the stages of the deliverables list line Item: Phase A: One, Two; Phase B: Three");
  });
});

describe("what the actions accept (6b)", () => {
  it("takes up to 100 stages, and a repeat in another group", () => {
    expect(STAGES_MAX).toBe(100);
    const groups = [
      { label: "Phase A", stages: ["One", "Two"] },
      { label: "Phase B", stages: ["One"] },
    ];
    const parsed = createGroupedProjectSchema.safeParse({
      clientId: CLIENT,
      name: "Project",
      recurrence: "monthly",
      stageGroups: groups,
      deliverables: [
        { title: "Item 1", stageGroups: null },
        { title: "Item 2", stageGroups: groups },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a repeat in one group, two untitled groups, more than 100 stages", () => {
    const base = { clientId: CLIENT, name: "Project", recurrence: "monthly", deliverables: [] };
    const repeat = createGroupedProjectSchema.safeParse({
      ...base,
      stageGroups: [{ label: "Phase A", stages: ["One", "one"] }],
    });
    expect(repeat.success).toBe(false);
    const untitled = createGroupedProjectSchema.safeParse({
      ...base,
      stageGroups: [
        { label: null, stages: ["One"] },
        { label: null, stages: ["Two"] },
      ],
    });
    expect(untitled.success).toBe(false);
    const many = updateBlueprintSchema.safeParse({
      blueprintId: CLIENT,
      stageGroups: [{ label: "Phase A", stages: Array.from({ length: 101 }, (_, i) => `S${i}`) }],
    });
    expect(many.success).toBe(false);
  });

  it("takes a group for a stage (null: the untitled one) and a group rename", () => {
    expect(
      addItemStageSchema.safeParse({ itemId: CLIENT, name: "One", groupLabel: null }).success,
    ).toBe(true);
    expect(
      updateItemStageGroupSchema.safeParse({ itemId: CLIENT, label: null, newLabel: "Phase A" })
        .success,
    ).toBe(true);
    expect(
      updateItemStageGroupSchema.safeParse({ itemId: CLIENT, label: "Phase A", newLabel: " " })
        .success,
    ).toBe(false);
  });
});
