import type { ItemState } from "./types";

/**
 * What one deliverable's row on the project page reads at a glance (ROADMAP 6b.11, the owner's
 * feedback of 2026-10-16, unit E+): one compact strip per stage group, "Next: ‹stage›", and whether
 * Mark done is the moment's commit action. Pure, unit-tested (`tests/deliverable.test.ts`); works on
 * the team's existing data as it is (a stage list from before groups is one untitled group, which
 * reads as one strip "Stages").
 */

type RowStage = { id: string; name: string; done: boolean };
type RowGroup = { label: string | null; stages: readonly RowStage[] };
export type RowItem = {
  state: ItemState;
  nextStageId: string | null;
  stages: readonly RowStage[];
  groups: readonly RowGroup[];
};

/** One group's strip: its words, its segments (done solid, the next one lighter) and its key. */
export type GroupStrip = {
  /** Stable within the deliverable: the group's label, "" for the untitled group. */
  key: string;
  /** "Edit"; "Stages" for the untitled group (a list from before groups). */
  label: string;
  done: number;
  next: number;
  total: number;
};

/** The words an untitled group's strip reads (the screen's copy, not data). */
export const UNTITLED_GROUP_LABEL = "Stages";

const isDone = (state: ItemState) => state === "done" || state === "approved";

/**
 * Each stage group as a strip, in order. A done deliverable's strips read full (Mark done locks it,
 * so a stage left unticked still counts as delivered, as the cycle's ring counts it); an open one's
 * ticked stages, its next stage drawn lighter in the group that holds it; a closed or carried one's
 * ticks as they stand, with no next.
 */
export function groupStrips(item: RowItem): GroupStrip[] {
  return item.groups
    .filter((group) => group.stages.length > 0)
    .map((group) => {
      const total = group.stages.length;
      const done = isDone(item.state) ? total : group.stages.filter((stage) => stage.done).length;
      const holdsNext =
        item.state === "open" && group.stages.some((stage) => stage.id === item.nextStageId);
      return {
        key: group.label ?? "",
        label: group.label ?? UNTITLED_GROUP_LABEL,
        done,
        next: holdsNext ? 1 : 0,
        total,
      };
    });
}

/**
 * The row's "Next" (the first unticked stage in order while open):
 * - `stage`: "Next: Colour";
 * - `ticked`: open, every stage ticked: ready to be marked done;
 * - `none`: open with no stages (Mark done is its only step);
 * - `finished`: done, closed or carried, shown with its state word instead of a next stage.
 */
export type NextStep =
  | { kind: "stage"; name: string }
  | { kind: "ticked" }
  | { kind: "none" }
  | { kind: "finished"; state: Exclude<ItemState, "open"> };

export function nextStep(item: RowItem): NextStep {
  if (item.state !== "open") return { kind: "finished", state: item.state };
  if (item.stages.length === 0) return { kind: "none" };
  const next = item.stages.find((stage) => stage.id === item.nextStageId);
  return next ? { kind: "stage", name: next.name } : { kind: "ticked" };
}

/** Every stage ticked and still open: Mark done is what is left (the owner's "prominent" case). */
export function readyToMarkDone(item: Pick<RowItem, "state" | "stages">): boolean {
  return (
    item.state === "open" && item.stages.length > 0 && item.stages.every((stage) => stage.done)
  );
}

/**
 * Which ready row carries the layer's one solid Mark done (ARCHITECTURE §14.1: one commit
 * action per layer, a list never repeats a solid button): the first ready one in the list's order
 * that may be marked done; the other ready ones get the outlined look. None when `allowed` is false
 * (Select mode, or another solid control on the screen).
 */
export function solidMarkDoneId<T extends Pick<RowItem, "state" | "stages"> & { id: string }>(
  items: readonly T[],
  canMark: (item: T) => boolean,
  allowed: boolean,
): string | null {
  if (!allowed) return null;
  return items.find((item) => readyToMarkDone(item) && canMark(item))?.id ?? null;
}

/**
 * Where the row's Mark done is (unit U): **on the row** once every stage is ticked (its clear next
 * step) or when the deliverable has no stages (nothing to tick); **in the row's ⋯** while stages
 * are left; nowhere while selecting (the bar's "Mark N done" does it) or for whoever may not.
 */
export function markDonePlace(
  item: Pick<RowItem, "state" | "stages">,
  allowed: boolean,
  selecting: boolean,
): "row" | "menu" | null {
  if (!allowed || selecting) return null;
  return readyToMarkDone(item) || item.stages.length === 0 ? "row" : "menu";
}

/**
 * The collapsed row's one bar and "n/m" (V3, the long-stage-list fix A/C): every stage of the
 * deliverable, however many groups, as one continuous bar; a done deliverable reads full, the open
 * one's next stage lighter (as the strips counted it).
 */
export function itemProgress(item: RowItem): { done: number; next: number; total: number } {
  return groupStrips(item).reduce(
    (sum, strip) => ({
      done: sum.done + strip.done,
      next: sum.next + strip.next,
      total: sum.total + strip.total,
    }),
    { done: 0, next: 0, total: 0 },
  );
}

/** From how many stages an ungrouped list is "long" (the owner's 2026-10-17 note: above ~8). */
export const LONG_STAGE_LIST = 9;

/**
 * Whether the expanded row offers "n stages: split them into groups?" (fix D): an open deliverable
 * with a long list whose stages are all outside a group. Only ever a suggestion: nothing is grouped
 * until the Admin chooses where each group starts.
 */
export function suggestsGrouping(item: Pick<RowItem, "state" | "stages" | "groups">): boolean {
  return (
    item.state === "open" &&
    item.stages.length >= LONG_STAGE_LIST &&
    item.groups.every((group) => group.label === null)
  );
}

/** "Round 2", "round 1", "R3": a stage typed as a numbered round of changes. */
const NUMBERED_ROUND = /\bround\s*\d+\b|\br\d+\b/i;

/**
 * Whether the expanded row shows the revision-round tip (fix E): two or more stages typed as
 * numbered rounds ("… Round 1", "… Round 2"), where "+ Another revision round" adds the next one in
 * its place when it is needed.
 */
export function typesNumberedRounds(item: Pick<RowItem, "state" | "stages">): boolean {
  return (
    item.state === "open" && item.stages.filter((stage) => NUMBERED_ROUND.test(stage.name)).length >= 2
  );
}
