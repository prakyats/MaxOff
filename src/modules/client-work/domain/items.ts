import { groupStageLabel } from "@/core/lib/stage-groups";
import { addISTDays, formatIST, istDayStart, istWeekday, type ISODate } from "@/core/time";

import type { Cycle, Item, ItemRow, ItemStage, ItemState, Stage } from "./types";

/**
 * The pure rules of client items (WORKFLOWS §5.3, §5.4 items 10, 16, 18; kickoff 7 decisions 18,
 * 19, 26): overdue, due this week, the progress line, the carried-in mark and what a viewer may
 * do to an item. Unit-tested (`tests/items.test.ts`).
 */

/** "d MMM" for an ISO date ("8 Oct"). */
export function shortDate(date: ISODate): string {
  return formatIST(istDayStart(date), "d MMM");
}

/** Overdue = open with a planned date before today (IST) (decision 10). */
export function isOverdue(item: Pick<Item, "state" | "plannedDate">, today: ISODate): boolean {
  return item.state === "open" && item.plannedDate !== null && item.plannedDate < today;
}

/** The Sunday that ends the IST week (Monday to Sunday) holding `today`. */
export function weekEnd(today: ISODate): ISODate {
  const weekday = istWeekday(today); // 0 = Sunday
  return addISTDays(today, weekday === 0 ? 0 : 7 - weekday);
}

/**
 * The Admin's Client work on Today (decision 19): open items overdue or planned for this week,
 * oldest planned date first. Items with no planned date are never here (decision 10).
 */
export function dueThisWeek<T extends Pick<Item, "state" | "plannedDate" | "title" | "id">>(
  items: readonly T[],
  today: ISODate,
): T[] {
  const end = weekEnd(today);
  return items
    .filter((item) => item.state === "open" && item.plannedDate !== null && item.plannedDate <= end)
    .sort(
      (a, b) =>
        (a.plannedDate ?? "").localeCompare(b.plannedDate ?? "") ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole IST days from `from` to `to` (both ISO dates). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((istDayStart(to).getTime() - istDayStart(from).getTime()) / DAY_MS);
}

/**
 * A planned date's words: `text` whole ("Planned 18 Oct · 2 days late"), and its parts as a row
 * draws them, the date (`date`, "Planned 18 Oct") and the lateness (`late`, "2 days late", the red
 * chip: text colour never carries a status alone, the design gate of 23 Oct).
 */
export type PlannedLine = { text: string; overdue: boolean; date: string; late: string | null };

/**
 * A row's planned-date words, keeping "Planned" (6b.11 (2), owner 2026-10-10): "Planned 21 Oct",
 * "Planned today", and once it has passed on an open deliverable "Planned 18 Oct · 2 days late"
 * (`overdue`: the overdue tone); null without a date (the project page says "Not planned").
 */
export function plannedLine(
  item: Pick<Item, "state" | "plannedDate">,
  today: ISODate,
): PlannedLine | null {
  if (item.plannedDate === null) return null;
  const date = `Planned ${shortDate(item.plannedDate)}`;
  if (isOverdue(item, today)) {
    const days = daysBetween(item.plannedDate, today);
    const late = `${days} ${days === 1 ? "day" : "days"} late`;
    return { text: `${date} · ${late}`, overdue: true, date, late };
  }
  if (item.plannedDate === today && item.state === "open")
    return { text: "Planned today", overdue: false, date: "Planned today", late: null };
  return { text: date, overdue: false, date, late: null };
}

export type Progress = {
  /** The cycle's items not cancelled and not carried out (carried-in ones count). */
  total: number;
  /** Done (approved in the same step since amendment D3; a done item from before it too). */
  done: number;
  /** Cancelled ("closed") items, shown beside the line. */
  closed: number;
};

/** Decision 18's numbers for one cycle's items (amendment D3: one "done" figure). */
export function progressOf(items: readonly Pick<Item, "state">[]): Progress {
  let total = 0;
  let done = 0;
  let closed = 0;
  for (const item of items) {
    if (item.state === "cancelled") {
      closed += 1;
      continue;
    }
    if (item.state === "carried") continue;
    total += 1;
    if (item.state === "done" || item.state === "approved") done += 1;
  }
  return { total, done, closed };
}

/** "9/12 done · 1 closed" (decision 18, amendment D3); "No deliverables in this cycle." when empty. */
export function progressLine(progress: Progress): string {
  if (progress.total === 0 && progress.closed === 0) return "No deliverables in this cycle.";
  const parts = [`${progress.done}/${progress.total} done`];
  if (progress.closed > 0) parts.push(`${progress.closed} closed`);
  return parts.join(" · ");
}

/**
 * "Carried from September" (decision 12, 26): the origin cycle's label, without its year when it
 * is this cycle's year ("September 2026" in a 2026 cycle reads "September").
 */
export function carriedFromLabel(origin: string | null, current: string | null): string {
  if (!origin) return "Carried forward";
  const year = /\s(\d{4})$/.exec(origin)?.[1];
  const sameYear = year !== undefined && current !== null && current.endsWith(` ${year}`);
  return `Carried from ${sameYear ? origin.slice(0, -5) : origin}`;
}

/** The cycle the project page opens on: the one running today, else the latest begun, else the first. */
export function currentCycle<T extends Pick<Cycle, "periodStart" | "periodEnd">>(
  cycles: readonly T[],
  today: ISODate,
): T | null {
  if (cycles.length === 0) return null;
  const running = cycles.find(
    (cycle) =>
      cycle.periodStart === null ||
      (cycle.periodStart <= today && (cycle.periodEnd === null || cycle.periodEnd >= today)),
  );
  if (running) return running;
  const begun = cycles
    .filter((cycle) => cycle.periodStart !== null && cycle.periodStart <= today)
    .sort((a, b) => (b.periodStart ?? "").localeCompare(a.periodStart ?? ""));
  return begun[0] ?? cycles[0] ?? null;
}

/** Cycles in time order (one-time first, then by period). */
export function sortCycles<T extends Pick<Cycle, "periodStart" | "id">>(cycles: readonly T[]): T[] {
  return [...cycles].sort(
    (a, b) => (a.periodStart ?? "").localeCompare(b.periodStart ?? "") || a.id.localeCompare(b.id),
  );
}

/** A cycle whose period has ended (a one-time cycle never ends, 7A "As built"). */
export function cycleEnded(cycle: Pick<Cycle, "periodEnd">, today: ISODate): boolean {
  return cycle.periodEnd !== null && cycle.periodEnd < today;
}

/** Items in their list order (fractional positions compare as plain strings, collate "C"). */
export function sortItems<T extends Pick<Item, "position" | "id">>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1,
  );
}

type StageOrder = Pick<Stage, "position" | "id" | "groupLabel" | "groupPosition">;

/**
 * Stages in the order the screens show them (6b, DATA-MODEL §5b): the untitled group first (every
 * stage from before groups is in it), then the named groups by their key, each group's stages by
 * `position` (the keys compare as plain strings, collate "C").
 */
export function compareStages(a: StageOrder, b: StageOrder): number {
  const untitled = Number(b.groupLabel === null) - Number(a.groupLabel === null);
  if (untitled !== 0) return untitled;
  const ga = a.groupPosition ?? "";
  const gb = b.groupPosition ?? "";
  if (ga !== gb) return ga < gb ? -1 : 1;
  if (a.groupLabel !== b.groupLabel) return (a.groupLabel ?? "") < (b.groupLabel ?? "") ? -1 : 1;
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Stages that still apply (removed ones are archived, decision 8, amendment D2), in order (by
 * group, then place): a project's default stages or an item's own.
 */
export function activeStages<T extends Pick<Stage, "archived"> & StageOrder>(
  stages: readonly T[],
): T[] {
  return stages.filter((stage) => !stage.archived).sort(compareStages);
}

/** Each item's own active stages, in order (amendment D2; by group since 6b). */
export function stagesByItem<T extends Pick<ItemStage, "itemId" | "archived"> & StageOrder>(
  stages: readonly T[],
): Map<string, T[]> {
  const byItem = new Map<string, T[]>();
  for (const stage of activeStages(stages)) {
    byItem.set(stage.itemId, [...(byItem.get(stage.itemId) ?? []), stage]);
  }
  return byItem;
}

/**
 * "Tick ‹stage› on N" (decision 16, amendment D2): the stage names the chosen items carry, in the
 * order they first appear, each with the stages of that name to tick (one per item that has it,
 * matched case-insensitively). An item without the name is left out of that choice. Since 6b a
 * stage is matched **in its group**: "Group · Stage" (`groupStageLabel`) ticks, per item, the
 * stage of that name in the group of that name; the untitled group's stages keep their plain name.
 */
export function stageChoices(
  items: readonly {
    stages: readonly { id: string; name: string; done: boolean; groupLabel?: string | null }[];
  }[],
): { key: string; name: string; stageIds: string[] }[] {
  const choices = new Map<string, { key: string; name: string; stageIds: string[] }>();
  for (const item of items) {
    for (const stage of item.stages) {
      const group = stage.groupLabel ?? null;
      const key = `${group === null ? "" : group.trim().toLowerCase()}\u0000${stage.name.trim().toLowerCase()}`;
      const choice = choices.get(key) ?? {
        key,
        name: groupStageLabel(group, stage.name),
        stageIds: [],
      };
      if (!stage.done) choice.stageIds.push(stage.id);
      choices.set(key, choice);
    }
  }
  return [...choices.values()].filter((choice) => choice.stageIds.length > 0);
}

/**
 * Which item states take ticks, Done, a reopen and edits (decisions 7, 9; Q5 (b); amendment D3:
 * done is approved in the same step, and a done item is reopened with a reason). `done` is only an
 * item from before amendment D: it behaves as it did, and can be reopened.
 */
export const ITEM_RULES = {
  ticks: (state: ItemState) => state === "open" || state === "done",
  markDone: (state: ItemState) => state === "open",
  reopen: (state: ItemState) => state === "approved" || state === "done",
  cancel: (state: ItemState) => state === "open" || state === "done",
  /** Every detail and the item's stages while open; only title and notes once done, closed or carried. */
  editAll: (state: ItemState) => state === "open" || state === "done",
} as const;

/** The cross-client list's state view (`?filter=`): live = the open items (and pre-D done ones). */
export type ItemFilter = "live" | "overdue";
export const ITEM_FILTERS: readonly ItemFilter[] = ["live", "overdue"];
export const ITEM_FILTER_LABELS: Record<ItemFilter, string> = {
  live: "Open",
  overdue: "Overdue",
};

export function parseItemFilter(value: string | undefined): ItemFilter {
  return value === "overdue" ? value : "live";
}

export function matchesFilter(
  item: Pick<Item, "state" | "plannedDate">,
  filter: ItemFilter,
  today: ISODate,
): boolean {
  return filter === "overdue"
    ? isOverdue(item, today)
    : item.state === "open" || item.state === "done";
}

/** The cross-client list's order: overdue first, then by planned date (none last), then title. */
export function sortItemRows<T extends Pick<ItemRow, "plannedDate" | "title" | "id">>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      (a.plannedDate ?? "9999").localeCompare(b.plannedDate ?? "9999") ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

export type AdminGroup<T> = { adminId: string | null; name: string; rows: T[] };

/**
 * The Owner's view of the list, grouped by the client's Admin (amendment C E1): Admins by name,
 * the Owner's own clients (no Admin) last.
 */
export function groupByAdmin<T extends Pick<ItemRow, "adminId">>(
  rows: readonly T[],
  names: Readonly<Record<string, string>>,
): AdminGroup<T>[] {
  const groups = new Map<string, AdminGroup<T>>();
  for (const row of rows) {
    const key = row.adminId ?? "";
    let group = groups.get(key);
    if (!group) {
      group = {
        adminId: row.adminId,
        name: row.adminId ? (names[row.adminId] ?? "An Admin") : "No Admin (yours)",
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()].sort((a, b) =>
    a.adminId === null ? 1 : b.adminId === null ? -1 : a.name.localeCompare(b.name),
  );
}

/** "1 deliverable", "3 deliverables" (6b: the screens call items deliverables). */
export function itemCount(n: number): string {
  return n === 1 ? "1 deliverable" : `${n} deliverables`;
}
