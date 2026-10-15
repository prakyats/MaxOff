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
    expect(choices.map(({ name, stageIds }) => ({ name, stageIds }))).toEqual([
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

// The audit trigger's shapes: an insert's `new` is the whole row; an update's `old` / `new` hold
// only the changed keys; the stage functions put `stage_id`, `name` and `group` in the meta.
describe("the history of stage groups (6b)", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "s1",
    project_id: "p1",
    name: "Shoot",
    position: "m",
    group_label: null,
    group_position: null,
    archived_at: null,
    ...over,
  });

  it("says a default stage in a group as 'Group · Stage', a plain one by its name", () => {
    expect(
      say({ action: "insert", new: row({ group_label: "Phase A", group_position: "a" }) }),
    ).toBe("added the default stage Phase A · Shoot");
    expect(say({ action: "insert", new: row({}) })).toBe("added the default stage Shoot");
    expect(
      say({
        action: "archived",
        old: { archived_at: null },
        new: { archived_at: "2026-10-15T10:00:00Z" },
        meta: { stage_id: "s1", name: "Shoot", group: "Phase A" },
      }),
    ).toBe("removed the default stage Phase A · Shoot");
    expect(
      say({
        old: { name: "Shoot" },
        new: { name: "Film" },
        meta: { stage_id: "s1", name: "Shoot", group: "Phase A" },
      }),
    ).toBe("renamed the default stage Phase A · Shoot to Film");
    expect(
      say({
        old: { position: "m" },
        new: { position: "c" },
        meta: { stage_id: "s1", name: "Shoot", group: null },
      }),
    ).toBe("moved the default stage Shoot");
  });

  it("says a group's own change: named, renamed, its name taken off, moved", () => {
    const grouped = (action: string, group: string | null, to: string | null, changed: object) =>
      say({
        action,
        old: Object.fromEntries(Object.keys(changed).map((key) => [key, null])),
        new: changed as Record<string, unknown>,
        meta: { group, to, stage_id: "s1", name: "Shoot" },
      });
    expect(grouped("group_renamed", null, "Phase A", { group_label: "Phase A" })).toBe(
      "named the default stage group Phase A",
    );
    expect(grouped("group_renamed", "Phase A", "Phase C", { group_label: "Phase C" })).toBe(
      "renamed the default stage group Phase A to Phase C",
    );
    expect(grouped("group_renamed", "Phase A", null, { group_label: null })).toBe(
      "took the name off the default stage group Phase A",
    );
    expect(grouped("group_moved", "Phase A", null, { group_position: "c" })).toBe(
      "moved the default stage group Phase A",
    );
    expect(
      say({
        entity: "project_item_stage_list",
        action: "group_moved",
        old: { group_position: "a" },
        new: { group_position: "c" },
        meta: { group: "Phase B", to: null, stage_id: "s1", name: "One" },
      }),
    ).toBe("moved the stage group Phase B on Item 1");
  });

  it("says one group rename once, however many stage rows it wrote, across a page's cut too", () => {
    const rename = (id: number, stage: string) =>
      entry({
        id,
        entityId: stage,
        action: "group_renamed",
        old: { group_label: "Phase A" },
        new: { group_label: "Phase C" },
        meta: { group: "Phase A", to: "Phase C", stage_id: stage, name: stage },
      });
    const added = entry({ id: 0, action: "insert", new: row({ name: "One" }) });
    expect(
      describeActivityLines(
        [rename(3, "s3"), rename(2, "s2"), rename(1, "s1"), added],
        context,
      ).map((line) => line.text),
    ).toEqual([
      "renamed the default stage group Phase A to Phase C",
      "added the default stage One",
    ]);
    // The next page starts inside the same rename: its rows are not said again.
    expect(
      describeActivityLines([rename(1, "s1"), added], context, rename(2, "s2")).map(
        (line) => line.text,
      ),
    ).toEqual(["added the default stage One"]);
  });

  it("says a stage moved into or out of a group, and a deliverable's tick in its group", () => {
    expect(
      say({
        old: { group_label: null, group_position: null, position: "m" },
        new: { group_label: "Phase B", group_position: "b", position: "a" },
        meta: { stage_id: "s1", name: "Shoot", group: null },
      }),
    ).toBe("moved the default stage Shoot into the group Phase B");
    expect(
      say({
        old: { group_label: "Phase B", group_position: "b" },
        new: { group_label: null, group_position: null },
        meta: { stage_id: "s1", name: "Shoot", group: "Phase B" },
      }),
    ).toBe("moved the default stage Phase B · Shoot out of its group");
    expect(
      say({
        entity: "project_item_stage_list",
        action: "ticked",
        old: { done_at: null, done_by: null },
        new: { done_at: "2026-10-15T10:00:00Z", done_by: "r" },
        meta: { stage_id: "s1", name: "Shoot", group: "Phase A" },
      }),
    ).toBe("ticked Phase A · Shoot on Item 1");
    expect(
      say({
        entity: "project_item_stage_list",
        old: { name: "Cut" },
        new: { name: "Trim" },
        meta: { stage_id: "s1", name: "Cut", group: null },
      }),
    ).toBe("renamed the stage Cut to Trim on Item 1");
  });

  it("says a line's groups", () => {
    expect(
      say({
        entity: "project_item_blueprints",
        old: { stages: ["One"], stage_groups: null },
        new: {
          stage_groups: [
            { label: "Phase A", stages: ["One", "Two"] },
            { label: "Phase B", stages: ["Three"] },
          ],
          stages: ["One", "Two", "Three"],
        },
      }),
    ).toBe("set the stages of a deliverables list line: Phase A: One, Two; Phase B: Three");
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
