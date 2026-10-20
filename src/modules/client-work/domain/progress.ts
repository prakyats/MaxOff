import { formatIST, type ISODate } from "@/core/time";

import type { ItemState } from "./types";

/**
 * The cycle's progress indicator (ROADMAP 6b.11 (5); PRODUCT §4.5): built from the **stages
 * ticked across every deliverable**, so each tick moves it, not only a deliverable marked done.
 * Pure, unit-tested (`tests/progress.test.ts`).
 *
 * - **Counted:** every deliverable but the closed (cancelled) ones and the ones carried out of the
 *   cycle (they were not delivered here). A carried-in one counts.
 * - **Units:** each counted deliverable is worth its own stages, or one unit when it has none.
 * - **Done units:** a done deliverable's every unit (Mark done locks it, so a stage left unticked
 *   still counts as delivered); an open one's ticked stages.
 * - **Next units:** each open deliverable's next stage to tick (the lighter segments).
 * - **Behind plan:** the open deliverables whose planned date has passed (IST), counted.
 */

export type MeterItem = {
  state: ItemState;
  plannedDate: string | null;
  stages: readonly { done: boolean }[];
};

export type CycleMeter = {
  /** Segments in all: one per stage of every counted deliverable (one for a stageless one). */
  units: number;
  /** Segments filled solid. */
  done: number;
  /** Segments drawn lighter: each open deliverable's next stage. */
  next: number;
  /** The whole figure: 100 only when everything is done (never rounded up to it). */
  percent: number;
  stages: { done: number; total: number };
  deliverables: { done: number; total: number };
  /** Closed (cancelled) deliverables, left out of the counts above. */
  closed: number;
  /** Open deliverables whose planned date has passed. */
  behind: number;
  /** Some open deliverable has a planned date (so "on track" means something). */
  planned: boolean;
  /** Every counted deliverable done (and there is at least one). */
  complete: boolean;
};

const isDone = (state: ItemState) => state === "done" || state === "approved";

export function cycleMeter(items: readonly MeterItem[], today: ISODate): CycleMeter {
  let units = 0;
  let done = 0;
  let next = 0;
  let stagesDone = 0;
  let stagesTotal = 0;
  let itemsDone = 0;
  let itemsTotal = 0;
  let behind = 0;
  let closed = 0;
  let planned = false;
  for (const item of items) {
    if (item.state === "cancelled") closed += 1;
    if (item.state === "cancelled" || item.state === "carried") continue;
    itemsTotal += 1;
    const count = item.stages.length;
    stagesTotal += count;
    units += Math.max(count, 1);
    if (isDone(item.state)) {
      itemsDone += 1;
      done += Math.max(count, 1);
      stagesDone += count;
      continue;
    }
    const ticked = item.stages.filter((stage) => stage.done).length;
    done += ticked;
    stagesDone += ticked;
    if (ticked < count) next += 1;
    if (item.plannedDate !== null) {
      planned = true;
      if (item.plannedDate < today) behind += 1;
    }
  }
  const complete = itemsTotal > 0 && itemsDone === itemsTotal;
  return {
    units,
    done,
    next,
    percent: percentOf(done, units),
    stages: { done: stagesDone, total: stagesTotal },
    deliverables: { done: itemsDone, total: itemsTotal },
    closed,
    behind,
    planned,
    complete,
  };
}

/** A share as a whole percent: 0 for nothing, 100 only when all of it, never rounded up to 100. */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0 || part <= 0) return 0;
  if (part >= whole) return 100;
  return Math.min(99, Math.max(1, Math.round((part / whole) * 100)));
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The calm line under the figure: "12 of 18 stages · 3 of 7 deliverables done"; without stages
 * "3 of 7 deliverables done"; "No deliverables in this cycle." when there is nothing to count.
 * A cancelled project says so (B8, UX review 2026-10-21): "Cancelled 21 Oct · 1 deliverable
 * closed", never "No deliverables in this cycle".
 */
export function meterLine(meter: CycleMeter, cancelledAt: string | null = null): string {
  if (cancelledAt !== null) {
    const when = `Cancelled ${formatIST(cancelledAt, "d MMM")}`;
    return meter.closed > 0
      ? `${when} · ${plural(meter.closed, "deliverable", "deliverables")} closed`
      : when;
  }
  if (meter.deliverables.total === 0) return "No deliverables in this cycle.";
  const deliverables = `${meter.deliverables.done} of ${plural(meter.deliverables.total, "deliverable", "deliverables")} done`;
  if (meter.stages.total === 0) return deliverables;
  return `${meter.stages.done} of ${plural(meter.stages.total, "stage", "stages")} · ${deliverables}`;
}

export type Pace = { text: string; tone: "danger" | "success" } | null;

/**
 * The quiet pace beside the figure, from the planned dates: "2 behind plan" (in the overdue tone:
 * those deliverables are overdue), "On track", or nothing when the cycle is complete or no open
 * deliverable has a date.
 */
export function meterPace(meter: CycleMeter): Pace {
  if (meter.complete) return null;
  if (meter.behind > 0) return { text: `${meter.behind} behind plan`, tone: "danger" };
  if (!meter.planned) return null;
  return { text: "On track", tone: "success" };
}

/** "October 2026 complete", or "Every deliverable complete" for a cycle with no label. */
export function completeWords(label: string | null): string {
  return label ? `${label} complete` : "Every deliverable complete";
}

/** The device's note that a cycle's 100% moment was shown (once per cycle per device). */
export function celebratedKey(cycleId: string): string {
  return `maxoff.cycle-complete.${cycleId}`;
}

/**
 * Whether to play the 100% moment now: the cycle is complete and this device has not shown it
 * (`seen` is the stored note, null when there is none or storage is unavailable). A cycle reopened
 * below 100% and completed again does not play it twice.
 */
export function celebrateNow(complete: boolean, seen: string | null): boolean {
  return complete && seen === null;
}

/** One deliverable's own stages as a miniature: ticked, the next one, all (6b.11 (5)). */
export function itemMeter(item: Pick<MeterItem, "state" | "stages">): {
  done: number;
  next: number;
  total: number;
} {
  const total = item.stages.length;
  if (isDone(item.state)) return { done: total, next: 0, total };
  const done = item.stages.filter((stage) => stage.done).length;
  const open = item.state === "open";
  return { done, next: open && done < total ? 1 : 0, total };
}
