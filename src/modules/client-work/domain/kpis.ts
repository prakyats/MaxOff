import { istDayStart, toISTDate, type ISODate } from "@/core/time";

import { activeStages } from "./items";
import type { Cycle, Item, Stage, Tick } from "./types";

/**
 * The Admin's work report's item KPIs (7.4; PRODUCT §4.13, kickoff 7 decision 25), from the items
 * the viewer sees (RLS: an Admin's clients). Pure, unit-tested.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * **On time**: items approved on or before their planned date ÷ items with a planned date, over
 * the items planned in the period (closed and carried ones left out: they were not delivered
 * there).
 */
export function onTime(
  items: readonly Pick<Item, "plannedDate" | "state" | "approvedAt">[],
  period: { from: ISODate; to: ISODate },
): { onTime: number; planned: number } {
  let planned = 0;
  let early = 0;
  for (const item of items) {
    if (!item.plannedDate || item.plannedDate < period.from || item.plannedDate > period.to)
      continue;
    if (item.state === "cancelled" || item.state === "carried") continue;
    planned += 1;
    if (
      item.state === "approved" &&
      item.approvedAt &&
      toISTDate(item.approvedAt) <= item.plannedDate
    ) {
      early += 1;
    }
  }
  return { onTime: early, planned };
}

/** "6 of 8 on time (75%)", "Nothing planned". */
export function onTimeWords({
  onTime: early,
  planned,
}: {
  onTime: number;
  planned: number;
}): string {
  if (planned === 0) return "Nothing planned";
  return `${early} of ${planned} on time (${Math.round((early / planned) * 100)}%)`;
}

/**
 * **Cycle progress**: done ÷ planned and approved ÷ done, over the current cycles' items (closed
 * and carried-out ones left out, as the progress line).
 */
export function cycleProgressWords(progress: {
  total: number;
  done: number;
  approved: number;
}): string {
  if (progress.total === 0) return "No current items";
  return `${progress.done} of ${progress.total} done · ${progress.approved} of ${progress.done} approved`;
}

export type SitRow = { stage: string; count: number; medianDays: number };

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * **Where items sit longest**: the open items grouped by their first unticked stage (the project's
 * active stages in order), each with its count and the median days waiting there (since the
 * previous stage's tick, or the cycle's start; a one-time cycle's start is its creation). Items of
 * projects with no stages, or with every stage ticked, are left out. Longest wait first.
 */
export function sitLongest(input: {
  items: readonly Pick<Item, "id" | "projectId" | "cycleId" | "state" | "createdAt">[];
  stages: readonly Stage[];
  ticks: readonly Tick[];
  cycles: readonly Pick<Cycle, "id" | "periodStart">[];
  now: Date;
}): SitRow[] {
  const stagesOf = new Map<string, Stage[]>();
  for (const stage of activeStages(input.stages)) {
    stagesOf.set(stage.projectId, [...(stagesOf.get(stage.projectId) ?? []), stage]);
  }
  const startOf = new Map(input.cycles.map((cycle) => [cycle.id, cycle.periodStart]));
  const groups = new Map<string, number[]>();
  for (const item of input.items) {
    if (item.state !== "open") continue;
    const stages = stagesOf.get(item.projectId) ?? [];
    if (stages.length === 0) continue;
    const ticked = new Map(
      input.ticks
        .filter((tick) => tick.itemId === item.id && tick.doneAt !== null)
        .map((tick) => [tick.stageId, tick.doneAt as string]),
    );
    const index = stages.findIndex((stage) => !ticked.has(stage.id));
    if (index < 0) continue;
    const stage = stages[index];
    if (!stage) continue;
    const previous = index > 0 ? ticked.get(stages[index - 1]?.id ?? "") : undefined;
    const periodStart = startOf.get(item.cycleId);
    const since = previous
      ? Date.parse(previous)
      : periodStart
        ? istDayStart(periodStart).getTime()
        : Date.parse(item.createdAt);
    const days = Math.max(0, (input.now.getTime() - since) / DAY_MS);
    groups.set(stage.name, [...(groups.get(stage.name) ?? []), days]);
  }
  return [...groups.entries()]
    .map(([stage, days]) => ({ stage, count: days.length, medianDays: median(days) }))
    .sort(
      (a, b) => b.medianDays - a.medianDays || b.count - a.count || a.stage.localeCompare(b.stage),
    );
}

/** "8 waiting at Edit · median 3 days". */
export function sitWords(row: SitRow): string {
  const days = Math.round(row.medianDays * 10) / 10;
  return `${row.count} waiting at ${row.stage} · median ${days} ${days === 1 ? "day" : "days"}`;
}
