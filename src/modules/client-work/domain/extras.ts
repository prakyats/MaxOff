import { addISTDays, type ISODate } from "@/core/time";

import { sortItems } from "./items";
import type { Cycle, Item, Recurrence } from "./types";

/**
 * "Keep this month's extra deliverables next month?" (ROADMAP 6b.16 (d); WORKFLOWS §5.4 "As built,
 * Release 2"). Pure, unit-tested.
 *
 * **An extra** is a deliverable added in the cycle itself (not carried in from an earlier one),
 * not closed, whose title (trimmed, ignoring case) is on no active line of the project's
 * deliverables list; one per title, the first in the list. The SQL `app.cycle_extras` is the same
 * rule (migration `client_work_bulk_and_rounds`): change both together.
 *
 * **When it is asked:** once per cycle (`cycle_keep_extras` records the answer), at the month's
 * end: from 6 days before the period's last day to 7 days after it (a week: the last 2 days to 2
 * days after), so the question is there in the last week of the month and still on the project
 * page in the first week of the next, whichever cycle the pager shows.
 */

const key = (title: string) => title.trim().toLowerCase();

export type ExtraCandidate = Pick<
  Item,
  "id" | "title" | "position" | "state" | "cycleId" | "originCycleId"
>;

/** The cycle's extras, in the cycle's order. */
export function cycleExtras<T extends ExtraCandidate>(
  cycleId: string,
  items: readonly T[],
  listTitles: readonly string[],
): T[] {
  const listed = new Set(listTitles.map(key));
  const seen = new Set<string>();
  return sortItems(items).filter((item) => {
    if (item.cycleId !== cycleId || item.originCycleId !== cycleId) return false;
    if (item.state === "cancelled" || listed.has(key(item.title))) return false;
    if (seen.has(key(item.title))) return false;
    seen.add(key(item.title));
    return true;
  });
}

const WINDOW: Record<Exclude<Recurrence, "one_time">, { before: number; after: number }> = {
  monthly: { before: 6, after: 7 },
  weekly: { before: 1, after: 2 },
};

/**
 * The cycle the question is about today, or null: an unanswered cycle of a recurring project whose
 * period ends within the window around today (the latest one when two are in it).
 */
export function extrasCycle<T extends Pick<Cycle, "periodEnd" | "extrasDecided">>(
  recurrence: Recurrence,
  cycles: readonly T[],
  today: ISODate,
): T | null {
  if (recurrence === "one_time") return null;
  const { before, after } = WINDOW[recurrence];
  const open = cycles.filter(
    (cycle) =>
      !cycle.extrasDecided &&
      cycle.periodEnd !== null &&
      addISTDays(cycle.periodEnd, -before) <= today &&
      today <= addISTDays(cycle.periodEnd, after),
  );
  open.sort((a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""));
  return open[0] ?? null;
}

/** The question's words: "Keep October 2026's extra deliverables next month?" */
export function extrasQuestion(recurrence: Recurrence, label: string | null): string {
  const unit = recurrence === "weekly" ? "week" : "month";
  return label
    ? `Keep ${label}'s extra deliverables next ${unit}?`
    : `Keep this ${unit}'s extra deliverables next ${unit}?`;
}
