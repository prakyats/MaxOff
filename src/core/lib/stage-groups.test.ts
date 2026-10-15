import { describe, expect, it } from "vitest";

import {
  countDeliverables,
  deliverablesFromJson,
  deliverablesIssue,
  expandQuantity,
  flattenGroups,
  groupRows,
  groupsFromJson,
  groupsFromNames,
  groupStageLabel,
  stageGroupsIssue,
} from "./stage-groups";

describe("stage groups on existing data", () => {
  it("reads a plain stage list as one untitled group, and an empty one as none", () => {
    expect(groupsFromNames(["A", " B "])).toEqual([{ label: null, stages: ["A", "B"] }]);
    expect(groupsFromNames([])).toEqual([]);
    expect(groupsFromJson(null, ["A"])).toEqual([{ label: null, stages: ["A"] }]);
  });

  it("reads the stored shape and flattens it back to the old column", () => {
    const groups = groupsFromJson(
      [
        { label: null, stages: ["A"] },
        { label: "Phase B", stages: ["B1", "B2"] },
      ],
      [],
    );
    expect(groups).toHaveLength(2);
    expect(flattenGroups(groups)).toEqual(["A", "B1", "B2"]);
  });

  it("opens an old template's items following its shared stages (the defaults)", () => {
    expect(deliverablesFromJson(null, ["Item 1", "Item 2"])).toEqual([
      { title: "Item 1", stageGroups: null },
      { title: "Item 2", stageGroups: null },
    ]);
    expect(deliverablesFromJson([{ title: "Item", stage_groups: null }], ["ignored"])).toEqual([
      { title: "Item", stageGroups: null },
    ]);
  });

  it("orders rows: the untitled group first, then groups by their key, rows by position", () => {
    const rows = [
      { id: "b2", position: "n", groupLabel: "Phase B", groupPosition: "v" },
      { id: "a1", position: "n", groupLabel: "Phase A", groupPosition: "g" },
      { id: "u2", position: "v", groupLabel: null, groupPosition: null },
      { id: "u1", position: "n", groupLabel: null, groupPosition: null },
      { id: "b1", position: "g", groupLabel: "Phase B", groupPosition: "v" },
    ];
    expect(groupRows(rows).map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      [null, ["u1", "u2"]],
      ["Phase A", ["a1"]],
      ["Phase B", ["b1", "b2"]],
    ]);
  });
});

describe("× N, counts and labels", () => {
  it("expands a name times N and keeps × 1 as typed", () => {
    expect(expandQuantity(" Item ", 3)).toEqual(["Item 1", "Item 2", "Item 3"]);
    expect(expandQuantity("Item", 1)).toEqual(["Item"]);
    expect(expandQuantity("Item", 0)).toEqual(["Item"]);
  });

  it("counts deliverables and stages, the defaults standing in for null groups", () => {
    const defaults = [{ label: "Phase A", stages: ["A1", "A2"] }];
    expect(
      countDeliverables(
        [
          { title: "One", stageGroups: null },
          { title: "Two", stageGroups: [{ label: null, stages: ["X"] }] },
        ],
        defaults,
      ),
    ).toEqual({ deliverables: 2, stages: 3 });
  });

  it("labels a stage by its group only when the group is named", () => {
    expect(groupStageLabel(null, "Edit")).toBe("Edit");
    expect(groupStageLabel("Phase A", "Edit")).toBe("Phase A · Edit");
  });
});

describe("the database's rules, in words", () => {
  it("accepts the same stage name in two groups but not twice in one", () => {
    expect(
      stageGroupsIssue([
        { label: "Phase A", stages: ["Edit"] },
        { label: "Phase B", stages: ["Edit"] },
      ]),
    ).toBeNull();
    expect(stageGroupsIssue([{ label: "Phase A", stages: ["Edit", "edit"] }])).toMatch(
      /listed twice in its group/,
    );
  });

  it("refuses two untitled groups, a repeated label, an empty group and more than 100 stages", () => {
    expect(
      stageGroupsIssue([
        { label: null, stages: ["A"] },
        { label: null, stages: ["B"] },
      ]),
    ).toMatch(/without a name/);
    expect(
      stageGroupsIssue([
        { label: "Phase A", stages: ["A"] },
        { label: "phase a", stages: ["B"] },
      ]),
    ).toMatch(/listed twice/);
    expect(stageGroupsIssue([{ label: "Phase A", stages: [] }])).toMatch(/at least one stage/);
    const many = Array.from({ length: 101 }, (_, i) => `S${i}`);
    expect(stageGroupsIssue([{ label: null, stages: many }])).toMatch(/at most 100/);
  });

  it("checks deliverables: a title each, at most 100, and each one's groups", () => {
    expect(deliverablesIssue([{ title: " ", stageGroups: null }])).toMatch(/title/);
    expect(
      deliverablesIssue([{ title: "Item", stageGroups: [{ label: "Phase A", stages: [] }] }]),
    ).toMatch(/^Item: /);
    expect(deliverablesIssue([{ title: "Item", stageGroups: null }])).toBeNull();
  });
});
