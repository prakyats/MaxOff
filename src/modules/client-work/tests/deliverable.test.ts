import { describe, expect, it } from "vitest";

import {
  groupStrips,
  markDonePlace,
  nextStep,
  readyToMarkDone,
  solidMarkDoneId,
  UNTITLED_GROUP_LABEL,
  type RowItem,
} from "../domain/deliverable";
import type { ItemState } from "../domain/types";

type Stage = { id: string; name: string; done: boolean; group: string | null };

/** A deliverable from its stages in order (the untitled group first, as `groupRows` keeps it). */
function deliverable(state: ItemState, stages: Stage[]): RowItem & { id: string; stages: Stage[] } {
  const labels = [...new Set(stages.map((stage) => stage.group))];
  const nextStageId = state === "open" ? (stages.find((stage) => !stage.done)?.id ?? null) : null;
  return {
    id: stages.map((stage) => stage.id).join("") || state,
    state,
    nextStageId,
    stages,
    groups: labels.map((label) => ({
      label,
      stages: stages.filter((stage) => stage.group === label),
    })),
  };
}

const stage = (id: string, done: boolean, group: string | null = null): Stage => ({
  id,
  name: `Stage ${id}`,
  done,
  group,
});

describe("a deliverable's strips (E+)", () => {
  it("draws one strip per stage group, the next stage lighter in the group that holds it", () => {
    const item = deliverable("open", [
      stage("a", true, "Shoot"),
      stage("b", true, "Shoot"),
      stage("c", true, "Edit"),
      stage("d", false, "Edit"),
      stage("e", false, "Edit"),
    ]);
    expect(groupStrips(item)).toEqual([
      { key: "Shoot", label: "Shoot", done: 2, next: 0, total: 2 },
      { key: "Edit", label: "Edit", done: 1, next: 1, total: 3 },
    ]);
  });

  it("reads a stage list from before groups as one strip, worded 'Stages'", () => {
    const item = deliverable("open", [stage("a", true), stage("b", false)]);
    expect(groupStrips(item)).toEqual([
      { key: "", label: UNTITLED_GROUP_LABEL, done: 1, next: 1, total: 2 },
    ]);
    expect(UNTITLED_GROUP_LABEL).toBe("Stages");
  });

  it("shows a done deliverable full, a closed one's ticks as they stand, none without stages", () => {
    const stages = [stage("a", true, "Edit"), stage("b", false, "Edit")];
    expect(groupStrips(deliverable("approved", stages))).toEqual([
      { key: "Edit", label: "Edit", done: 2, next: 0, total: 2 },
    ]);
    expect(groupStrips(deliverable("cancelled", stages))).toEqual([
      { key: "Edit", label: "Edit", done: 1, next: 0, total: 2 },
    ]);
    expect(groupStrips(deliverable("open", []))).toEqual([]);
  });
});

describe("a deliverable's Next (E+)", () => {
  it("names the first unticked stage in order while open", () => {
    const item = deliverable("open", [stage("a", true), stage("b", false), stage("c", false)]);
    expect(nextStep(item)).toEqual({ kind: "stage", name: "Stage b" });
  });

  it("is ticked when every stage is, none without stages, and a finished one's state", () => {
    expect(nextStep(deliverable("open", [stage("a", true)]))).toEqual({ kind: "ticked" });
    expect(nextStep(deliverable("open", []))).toEqual({ kind: "none" });
    expect(nextStep(deliverable("approved", [stage("a", false)]))).toEqual({
      kind: "finished",
      state: "approved",
    });
    expect(nextStep(deliverable("cancelled", [stage("a", false)]))).toEqual({
      kind: "finished",
      state: "cancelled",
    });
  });
});

describe("Mark done's emphasis (E+)", () => {
  it("is ready only when open and every stage is ticked", () => {
    expect(readyToMarkDone(deliverable("open", [stage("a", true), stage("b", true)]))).toBe(true);
    expect(readyToMarkDone(deliverable("open", [stage("a", true), stage("b", false)]))).toBe(false);
    expect(readyToMarkDone(deliverable("open", []))).toBe(false);
    expect(readyToMarkDone(deliverable("done", [stage("a", true)]))).toBe(false);
  });

  it("gives the solid red to the first ready row that may be marked, and to none when not allowed", () => {
    const notReady = deliverable("open", [stage("a", false)]);
    const first = deliverable("open", [stage("b", true)]);
    const second = deliverable("open", [stage("c", true)]);
    const items = [notReady, first, second];
    expect(solidMarkDoneId(items, () => true, true)).toBe(first.id);
    expect(solidMarkDoneId(items, (item) => item.id !== first.id, true)).toBe(second.id);
    expect(solidMarkDoneId(items, () => true, false)).toBeNull();
    expect(solidMarkDoneId([notReady], () => true, true)).toBeNull();
  });
});

describe("where a row's Mark done is (unit U)", () => {
  it("is on the row once every stage is ticked, in the row's ⋯ while stages are left", () => {
    expect(markDonePlace(deliverable("open", [stage("a", true)]), true, false)).toBe("row");
    expect(
      markDonePlace(deliverable("open", [stage("a", true), stage("b", false)]), true, false),
    ).toBe("menu");
  });

  it("is on the row for a deliverable without stages (nothing to tick)", () => {
    expect(markDonePlace(deliverable("open", []), true, false)).toBe("row");
  });

  it("is nowhere in Select mode or for whoever may not mark it done", () => {
    const ready = deliverable("open", [stage("a", true)]);
    expect(markDonePlace(ready, true, true)).toBeNull();
    expect(markDonePlace(ready, false, false)).toBeNull();
  });
});
