import { addISTDays, formatIST, istDayStart, istWeekday, type ISODate } from "@/core/time";

import type { Recurrence } from "./types";

/**
 * A cycle's period, as the database computes it (`app.period_start`, `app.period_next`,
 * `app.cycle_label`; WORKFLOWS §5.4 "As built": weekly = Monday to Sunday, monthly = the calendar
 * month, IST), for "Start next cycle" (decision 3: the next period, at most 7 days early). Pure.
 */

export function periodStart(recurrence: Exclude<Recurrence, "one_time">, day: ISODate): ISODate {
  if (recurrence === "monthly") return `${day.slice(0, 8)}01`;
  const weekday = istWeekday(day); // 0 = Sunday
  return addISTDays(day, -((weekday + 6) % 7));
}

export function periodNext(recurrence: Exclude<Recurrence, "one_time">, start: ISODate): ISODate {
  if (recurrence === "weekly") return addISTDays(start, 7);
  const [year, month] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

const at = (day: ISODate, pattern: string) => formatIST(istDayStart(day), pattern);

/** "October 2026" / "5–11 Oct 2026" / "29 Sep–5 Oct 2026" / "29 Dec 2026–4 Jan 2027". */
export function cycleLabel(recurrence: Exclude<Recurrence, "one_time">, start: ISODate): string {
  if (recurrence === "monthly") return at(start, "MMMM yyyy");
  const end = addISTDays(start, 6);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${at(start, "d")}–${at(end, "d MMM yyyy")}`;
  if (start.slice(0, 4) === end.slice(0, 4))
    return `${at(start, "d MMM")}–${at(end, "d MMM yyyy")}`;
  return `${at(start, "d MMM yyyy")}–${at(end, "d MMM yyyy")}`;
}

/**
 * The next period "Start next cycle" may begin now (decision 3), or null: a one-time project, a
 * next period more than 7 days away, or one that already has its cycle.
 */
export function nextStartable(
  recurrence: Recurrence,
  today: ISODate,
  existingStarts: readonly (string | null)[],
): { start: ISODate; label: string } | null {
  if (recurrence === "one_time") return null;
  const next = periodNext(recurrence, periodStart(recurrence, today));
  const daysAway =
    (istDayStart(next).getTime() - istDayStart(today).getTime()) / (24 * 60 * 60 * 1000);
  if (daysAway > 7 || existingStarts.includes(next)) return null;
  return { start: next, label: cycleLabel(recurrence, next) };
}

/** The periods the Item list's words name (amendment D4): a project's repeat, now. */
export type ItemListPeriods = {
  /** "month" / "week": what each new cycle is. */
  unit: "month" | "week";
  /** The first period whose cycle will still take the item list: where a new line starts. */
  from: string;
  /** The running cycle that takes new items through + Add item ("October 2026"), or null. */
  running: string | null;
};

/** The cycle facts the Item list's words read (`project_cycles`). */
export type ItemListCycle = {
  periodStart: string | null;
  periodEnd: string | null;
  label: string | null;
  /** False: a carry made the cycle while the client was not Active; the list joins it later. */
  itemListCopied: boolean;
};

/**
 * What the Item list says (amendment D4, owner 2026-10-09: wording only). A line added or removed
 * changes every cycle still to be built from the list, as the nightly `app.cycle_generate` builds
 * them (WORKFLOWS §5.4 item 9): the scan starts at the period holding today and skips only a period
 * whose cycle exists with the list already copied in (`item_list_copied`). So the current period is
 * named when it has no cycle yet (a Draft or Paused client, from its first Active night; a project
 * reopened, from the night after) or when its cycle was made by a carry while the client was not
 * Active (the list joins it once the client is Active); otherwise the next period, or the one after
 * when ⋯ Start began it early with the list. `running` is the cycle whose period holds today, only
 * when its list is already in (so its items no longer follow the list) and it can take items
 * (`canAddNow`: the project open or in progress, the client not Inactive, as `item_add`). Null for a
 * one-time project (no item list).
 */
export function itemListPeriods(
  recurrence: Recurrence,
  today: ISODate,
  cycles: readonly ItemListCycle[],
  canAddNow: boolean,
): ItemListPeriods | null {
  if (recurrence === "one_time") return null;
  const listed = new Set(
    cycles.filter((cycle) => cycle.itemListCopied).map((cycle) => cycle.periodStart),
  );
  const current = periodStart(recurrence, today);
  let from = current;
  while (listed.has(from)) from = periodNext(recurrence, from);
  const running = cycles.find((cycle) => cycle.itemListCopied && cycle.periodStart === current);
  return {
    unit: recurrence === "monthly" ? "month" : "week",
    from: cycleLabel(recurrence, from),
    running: canAddNow && running ? (running.label ?? cycleLabel(recurrence, current)) : null,
  };
}

/** The Item list sheet's words for those periods (amendment D4). */
export function itemListCopy(periods: ItemListPeriods): {
  description: string;
  added: (title: string) => string;
  removeDescription: string;
} {
  const every = `Every ${periods.unit} starts with these`;
  return periods.running
    ? {
        description: `${every}, from ${periods.from}. To add something to ${periods.running}, use + Add item on the project page.`,
        added: (title) => `${title} added from ${periods.from}`,
        removeDescription: `${periods.from} starts without it. ${periods.running}'s items don't change.`,
      }
    : {
        description: `${every}.`,
        added: (title) => `${title} added from ${periods.from}`,
        removeDescription: `${periods.from} starts without it.`,
      };
}
