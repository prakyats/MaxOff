import { describe, expect, it } from "vitest";

import { newDeliverables } from "./editing";

const phaseA = { id: "a", name: "Phase A", stages: ["One", "Two"] };

describe("a deliverable from a deliverable template (6b Release 2)", () => {
  const base = [
    { label: null, stages: ["Brief"] },
    { label: "Phase A", stages: ["Cut"] },
  ];

  it("gives each new deliverable its own copy of the template's groups", () => {
    const made = newDeliverables("Item", 2, [], base);
    expect(made.map((deliverable) => deliverable.stageGroups)).toEqual([base, base]);
    made[0]?.stageGroups?.[0]?.stages.push("Extra");
    expect(made[1]?.stageGroups?.[0]?.stages).toEqual(["Brief"]);
    expect(base[0]?.stages).toEqual(["Brief"]);
  });

  it("adds the ticked presets after the template's groups, renaming a clash", () => {
    const [made] = newDeliverables("Item", 1, [phaseA], base);
    expect(made?.stageGroups).toEqual([
      { label: null, stages: ["Brief"] },
      { label: "Phase A", stages: ["Cut"] },
      { label: "Phase A 2", stages: ["One", "Two"] },
    ]);
  });

  it("an empty template still gives the deliverable its own (empty) stages", () => {
    expect(newDeliverables("Item", 1, [], [])).toEqual([{ title: "Item", stageGroups: [] }]);
  });
});
