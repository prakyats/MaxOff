import { describe, expect, it } from "vitest";

import {
  addPresetGroup,
  addTypedGroup,
  countsLine,
  duplicateDeliverable,
  groupsSummary,
  linesOf,
  newDeliverables,
  removeAt,
  uniqueLabel,
  untitledFirst,
  updateGroup,
} from "./editing";

const phaseA = { id: "a", name: "Phase A", stages: ["One", "Two"] };
const phaseB = { id: "b", name: "Phase B", stages: ["Three"] };

describe("stage group editing", () => {
  it("adds a preset as a group named after it, numbering a repeated name", () => {
    const once = addPresetGroup([], phaseA);
    expect(once).toEqual([{ label: "Phase A", stages: ["One", "Two"] }]);
    const twice = addPresetGroup(once, { ...phaseA, name: "phase a" });
    expect(twice.map((group) => group.label)).toEqual(["Phase A", "phase a 2"]);
    expect(uniqueLabel(twice, "Phase A")).toBe("Phase A 3");
  });

  it("adds a typed group, and an unnamed one as the untitled group first", () => {
    const named = addTypedGroup([], "Phase B", ["Three"]);
    const both = addTypedGroup(named, "  ", ["Zero"]);
    expect(both).toEqual([
      { label: null, stages: ["Zero"] },
      { label: "Phase B", stages: ["Three"] },
    ]);
    expect(untitledFirst([both[1]!, both[0]!])).toEqual(both);
  });

  it("changes and removes one group, leaving the others", () => {
    const groups = [
      { label: "Phase A", stages: ["One"] },
      { label: "Phase B", stages: ["Two"] },
    ];
    expect(updateGroup(groups, 1, (group) => ({ ...group, label: "Phase C" }))[1]?.label).toBe(
      "Phase C",
    );
    expect(removeAt(groups, 0)).toEqual([{ label: "Phase B", stages: ["Two"] }]);
  });

  it("reads one stage per line, blanks dropped", () => {
    expect(linesOf(" One \n\n Two\n ")).toEqual(["One", "Two"]);
  });
});

describe("deliverable editing", () => {
  it("makes Name × N with the picked presets as each one's own groups", () => {
    const made = newDeliverables("Item", 3, [phaseA, phaseB]);
    expect(made.map((deliverable) => deliverable.title)).toEqual(["Item 1", "Item 2", "Item 3"]);
    expect(made[0]?.stageGroups).toEqual([
      { label: "Phase A", stages: ["One", "Two"] },
      { label: "Phase B", stages: ["Three"] },
    ]);
    // Copies, never shared: changing one leaves the others.
    made[0]?.stageGroups?.[0]?.stages.push("Extra");
    expect(made[1]?.stageGroups?.[0]?.stages).toEqual(["One", "Two"]);
  });

  it("keeps the name for × 1 and uses the default stages with no preset picked", () => {
    expect(newDeliverables("Item", 1, [])).toEqual([{ title: "Item", stageGroups: null }]);
  });

  it("duplicates a deliverable right after it, with its own copy of the groups", () => {
    const list = newDeliverables("Item", 2, [phaseA]);
    const next = duplicateDeliverable(list, 0);
    expect(next.map((deliverable) => deliverable.title)).toEqual([
      "Item 1",
      "Item 1 (copy)",
      "Item 2",
    ]);
    expect(next[1]?.stageGroups).not.toBe(next[0]?.stageGroups);
  });

  it("summarises groups and counts in the screens' words", () => {
    expect(groupsSummary([{ label: null, stages: ["One"] }])).toBe("1 stage");
    expect(
      groupsSummary([
        { label: "Phase A", stages: ["One", "Two"] },
        { label: "Phase B", stages: ["Three"] },
      ]),
    ).toBe("2 groups · 3 stages");
    expect(countsLine({ deliverables: 6, stages: 72 })).toBe("6 deliverables · 72 stages");
    expect(countsLine({ deliverables: 1, stages: 1 })).toBe("1 deliverable · 1 stage");
  });
});
