import { describe, expect, it } from "vitest";
import type { StageGroup } from "@/core/lib/stage-groups";

import {
  entryCounts,
  numbered,
  previewEntries,
  previewStats,
  statsLine,
  statsTiles,
} from "./preview-model";

const phases: StageGroup[] = [
  { label: "Phase A", stages: ["One", "Two"] },
  { label: "Phase B", stages: ["Three"] },
];
const defaults: StageGroup[] = [{ label: null, stages: ["One", "Two", "Three", "Four"] }];
const own = (title: string, groups = phases) => ({
  title,
  stageGroups: groups.map((group) => ({ label: group.label, stages: [...group.stages] })),
});
const usesDefaults = (title: string) => ({ title, stageGroups: null });

describe("the preview's entries", () => {
  it("collapses a numbered run of identical deliverables into one entry", () => {
    const entries = previewEntries(
      [
        usesDefaults("Item 1"),
        usesDefaults("Item 2"),
        usesDefaults("Item 3"),
        usesDefaults("Item 4"),
      ],
      defaults,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("Item 1–4");
    expect(entries[0]?.titles).toHaveLength(4);
    expect(entries[0]?.own).toBe(false);
    expect(entryCounts(entries[0]!)).toBe("4 stages each");
  });

  it("keeps different stages, a broken number run and own versus default apart", () => {
    const entries = previewEntries(
      [
        own("Item 1"),
        own("Item 2"),
        own("Item 3", [{ label: "Phase A", stages: ["One"] }]),
        own("Item 5"),
        usesDefaults("Post 1"),
        own("Post 2", [...defaults]),
        own("Other"),
      ],
      defaults,
    );
    expect(entries.map((entry) => entry.label)).toEqual([
      "Item 1–2",
      "Item 3",
      "Item 5",
      "Post 1",
      "Post 2",
      "Other",
    ]);
    expect(entryCounts(entries[0]!)).toBe("2 groups · 3 stages each");
    expect(entryCounts(entries[1]!)).toBe("1 group · 1 stage");
    expect(entries.map((entry) => entry.own)).toEqual([true, true, true, false, true, true]);
  });

  it("reads a trailing number as the name's place in a run", () => {
    expect(numbered("Item 12")).toEqual({ base: "Item", number: 12 });
    expect(numbered("Item")).toBeNull();
    expect(numbered("42")).toBeNull();
  });
});

describe("the preview's summary", () => {
  it("counts deliverables, distinct named groups and every stage", () => {
    const stats = previewStats([own("Item 1"), own("Item 2"), usesDefaults("Post 1")], defaults);
    expect(stats).toEqual({ deliverables: 3, groups: 2, stages: 10 });
    expect(statsLine(stats)).toBe("3 deliverables · 2 groups · 10 stages");
    expect(statsTiles({ deliverables: 1, groups: 1, stages: 1 }).map((tile) => tile.word)).toEqual([
      "deliverable",
      "group",
      "stage",
    ]);
  });
});
