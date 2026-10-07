import { addISTDays, type ISODate, istWeekday, toISTDate } from "@/core/time";

/**
 * The Alerts list's shape (5B decision 10): grouped by IST day, an "All | Unread" filter, and
 * same-record runs drawn as one row with a count. Pure, so the screen's rules are tested alone.
 */

export type AlertsFilter = "all" | "unread";

/** The filter from the address (`?show=unread`); anything else is All. */
export function alertsFilterFrom(value: unknown): AlertsFilter {
  return value === "unread" ? "unread" : "all";
}

/** The address of a page of the list under a filter: page 1 and All need no query. */
export function alertsHref(filter: AlertsFilter, page = 1): string {
  const query = new URLSearchParams();
  if (filter === "unread") query.set("show", "unread");
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return search ? `/notifications?${search}` : "/notifications";
}

export type DayGroup = "today" | "yesterday" | "this_week" | "older";

export const DAY_GROUP_LABELS: Record<DayGroup, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "Earlier this week",
  older: "Older",
};

/** The Monday of the IST week a date is in (weeks start on Monday here, as the calendar's). */
function mondayOf(date: ISODate): ISODate {
  return addISTDays(date, -((istWeekday(date) + 6) % 7));
}

/**
 * Which day group a notification sits in, by its IST day: today, yesterday, earlier in this
 * Monday-to-Sunday week, or older. On a Monday or Tuesday "Earlier this week" is empty.
 */
export function dayGroupOf(createdAt: string, today: ISODate): DayGroup {
  const day = toISTDate(createdAt);
  if (day >= today) return "today";
  if (day === addISTDays(today, -1)) return "yesterday";
  return day >= mondayOf(today) ? "this_week" : "older";
}

/** Rows (newest first) cut into their day groups, in order; empty groups are left out. */
export function groupByDay<T extends { createdAt: string }>(
  rows: readonly T[],
  today: ISODate,
): { group: DayGroup; label: string; rows: T[] }[] {
  const groups: { group: DayGroup; label: string; rows: T[] }[] = [];
  for (const row of rows) {
    const group = dayGroupOf(row.createdAt, today);
    const last = groups.at(-1);
    if (last?.group === group) last.rows.push(row);
    else groups.push({ group, label: DAY_GROUP_LABELS[group], rows: [row] });
  }
  return groups;
}

const COMMENT_TITLE = "Comment on ";

/**
 * What a row says it is. A run of comments only says how many ("3 comments on Edit", the
 * decision's own example) and carries no separate count; any other run keeps its newest title and
 * shows its count beside it.
 */
export function entryTitle(row: { title: string; runSize: number; runKinds: readonly string[] }): {
  title: string;
  count: number | null;
} {
  if (row.runSize <= 1) return { title: row.title, count: null };
  if (
    row.runKinds.length === 1 &&
    row.runKinds[0] === "task_comment" &&
    row.title.startsWith(COMMENT_TITLE)
  ) {
    return {
      title: `${row.runSize} comments on ${row.title.slice(COMMENT_TITLE.length)}`,
      count: null,
    };
  }
  return { title: row.title, count: row.runSize };
}
