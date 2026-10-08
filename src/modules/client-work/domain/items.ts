import { addISTDays, formatIST, istDayStart, istWeekday, type ISODate } from "@/core/time";

import type { Cycle, Item, ItemRow, ItemState, Stage, Tick } from "./types";

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

/** A row's planned-date words: "Overdue · 6 Oct", "Today", "Due 10 Oct", or null. */
export function plannedLine(
  item: Pick<Item, "state" | "plannedDate">,
  today: ISODate,
): { text: string; overdue: boolean } | null {
  if (item.plannedDate === null) return null;
  if (isOverdue(item, today))
    return { text: `Overdue · ${shortDate(item.plannedDate)}`, overdue: true };
  if (item.plannedDate === today && item.state === "open")
    return { text: "Due today", overdue: false };
  return { text: `Planned ${shortDate(item.plannedDate)}`, overdue: false };
}

export type Progress = {
  /** The cycle's items not cancelled and not carried out (carried-in ones count). */
  total: number;
  /** Done + approved. */
  done: number;
  approved: number;
  /** Cancelled ("closed") items, shown beside the line. */
  closed: number;
};

/** Decision 18's numbers for one cycle's items. */
export function progressOf(items: readonly Pick<Item, "state">[]): Progress {
  let total = 0;
  let done = 0;
  let approved = 0;
  let closed = 0;
  for (const item of items) {
    if (item.state === "cancelled") {
      closed += 1;
      continue;
    }
    if (item.state === "carried") continue;
    total += 1;
    if (item.state === "done" || item.state === "approved") done += 1;
    if (item.state === "approved") approved += 1;
  }
  return { total, done, approved, closed };
}

/** "9/12 done · 8/12 approved · 1 closed" (decision 18); "No items in this cycle." when empty. */
export function progressLine(progress: Progress): string {
  if (progress.total === 0 && progress.closed === 0) return "No items in this cycle.";
  const parts = [
    `${progress.done}/${progress.total} done`,
    `${progress.approved}/${progress.total} approved`,
  ];
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

/** A project's stages that still apply (removed ones are archived, decision 8), in order. */
export function activeStages<T extends Pick<Stage, "archived" | "position" | "id">>(
  stages: readonly T[],
): T[] {
  return sortItems(stages.filter((stage) => !stage.archived));
}

/** The item's ticked stage ids. */
export function tickedStages(itemId: string, ticks: readonly Tick[]): Set<string> {
  return new Set(
    ticks.filter((tick) => tick.itemId === itemId && tick.doneAt !== null).map((t) => t.stageId),
  );
}

/** Which item states take ticks, Done, Not done, approval and edits (decisions 6, 7; Q5 (b)). */
export const ITEM_RULES = {
  ticks: (state: ItemState) => state === "open" || state === "done",
  markDone: (state: ItemState) => state === "open",
  notDone: (state: ItemState) => state === "done",
  decide: (state: ItemState) => state === "done",
  cancel: (state: ItemState) => state === "open" || state === "done",
  /** Every detail while open or done; only title and notes once approved, closed or carried. */
  editAll: (state: ItemState) => state === "open" || state === "done",
} as const;

/** The cross-client list's state view (`?filter=`): live = open and done items. */
export type ItemFilter = "live" | "open" | "done" | "overdue";
export const ITEM_FILTERS: readonly ItemFilter[] = ["live", "overdue", "open", "done"];
export const ITEM_FILTER_LABELS: Record<ItemFilter, string> = {
  live: "Open and done",
  overdue: "Overdue",
  open: "Open",
  done: "Done, to approve",
};

export function parseItemFilter(value: string | undefined): ItemFilter {
  return value === "overdue" || value === "open" || value === "done" ? value : "live";
}

export function matchesFilter(
  item: Pick<Item, "state" | "plannedDate">,
  filter: ItemFilter,
  today: ISODate,
): boolean {
  switch (filter) {
    case "overdue":
      return isOverdue(item, today);
    case "open":
      return item.state === "open";
    case "done":
      return item.state === "done";
    default:
      return item.state === "open" || item.state === "done";
  }
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

/** "1 item", "3 items". */
export function itemCount(n: number): string {
  return n === 1 ? "1 item" : `${n} items`;
}
