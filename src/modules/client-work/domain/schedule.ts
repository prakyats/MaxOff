import { formatIST, istDayStart, type ISODate } from "@/core/time";

import { sortItems } from "./items";
import type { Item } from "./types";

/**
 * "Copy schedule as text" (ROADMAP 6b.16 (g)): a cycle's deliverables as plain text ready to paste
 * into WhatsApp. Pure, unit-tested. The heading (bold, WhatsApp's `*…*`) is the project and the
 * month; then each planned date (IST, "Tue 21 Oct") with its deliverables, earliest first; the
 * ones with no date last, under "Not planned yet". A done one says so; closed and carried ones
 * are left out (they are not this month's work). Never an amount.
 */

export type ScheduleItem = Pick<Item, "id" | "title" | "position" | "plannedDate" | "state">;

/** "Tue 21 Oct" (an IST calendar date). */
export function scheduleDay(date: ISODate): string {
  return formatIST(istDayStart(date), "EEE d MMM");
}

export function scheduleText({
  projectName,
  cycleLabel,
  items,
}: {
  projectName: string;
  cycleLabel: string | null;
  items: readonly ScheduleItem[];
}): string {
  const heading = cycleLabel ? `*${projectName} · ${cycleLabel}*` : `*${projectName}*`;
  const shown = sortItems(
    items.filter((item) => item.state !== "cancelled" && item.state !== "carried"),
  );
  if (shown.length === 0) return `${heading}\n\nNo deliverables yet.`;
  const line = (item: ScheduleItem) =>
    `• ${item.title}${item.state === "done" || item.state === "approved" ? " (done)" : ""}`;
  const dates = [...new Set(shown.flatMap((item) => (item.plannedDate ? [item.plannedDate] : [])))];
  dates.sort();
  const blocks = dates.map((date) =>
    [scheduleDay(date), ...shown.filter((item) => item.plannedDate === date).map(line)].join("\n"),
  );
  const unplanned = shown.filter((item) => item.plannedDate === null);
  if (unplanned.length > 0) blocks.push(["Not planned yet", ...unplanned.map(line)].join("\n"));
  return [heading, ...blocks].join("\n\n");
}
