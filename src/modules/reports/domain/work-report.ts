import {
  addISTDays,
  formatIST,
  isISODate,
  istDayStart,
  istWeekday,
  toISTDate,
  type ISODate,
} from "@/core/time";

/**
 * The Admin's work report (6.3; PRODUCT §4.13 "The Admin's report answers one question: is the
 * work getting done?"; Kickoff 6 decision 11, Kickoff 4 decision 18). Built now from the **task
 * KPIs only**: Rework, My turnaround, Overdue now and Acknowledgement lag, plus **Who is loaded this
 * week**, each split by engagement (employees and freelancers apart, so neither dilutes the other).
 * On time, Cycle progress and "where items sit longest" join in phase 7 with the items. Raw facts,
 * never a score (PRODUCT §2 principle 10). Pure, so every rule is unit-tested; RLS decides which
 * tasks the facts come from (the Admin's own scope).
 */

export type Engagement = "permanent" | "freelance";
export const ENGAGEMENTS: readonly Engagement[] = ["permanent", "freelance"];
export const ENGAGEMENT_LABELS: Record<Engagement, string> = {
  permanent: "Employees",
  freelance: "Freelancers",
};

// The period -------------------------------------------------------------------------------------------

export type Period = { kind: "week" | "month" | "custom"; from: ISODate; to: ISODate };

/** The longest custom range (a quarter): the report reads every hand-in in it. */
export const CUSTOM_MAX_DAYS = 92;

/** The IST week (Monday to Sunday) holding `date`. */
export function weekOf(date: ISODate): Period {
  const back = (istWeekday(date) + 6) % 7;
  const from = addISTDays(date, -back);
  return { kind: "week", from, to: addISTDays(from, 6) };
}

/** The calendar month holding `date`. */
export function monthOf(date: ISODate): Period {
  const from = `${date.slice(0, 7)}-01` as ISODate;
  const next = new Date(`${from}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const to = addISTDays(next.toISOString().slice(0, 10) as ISODate, -1);
  return { kind: "month", from, to };
}

function days(period: Pick<Period, "from" | "to">): number {
  return (
    Math.round(
      (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000,
    ) + 1
  );
}

/**
 * The period the address asks for (`?period=week|month&at=<date>`, or `?from=&to=` for a custom
 * range), else this week. A custom range is clamped to `CUSTOM_MAX_DAYS` and never runs past
 * today; an unreadable one falls back to this week.
 */
export function parsePeriod(
  params: Readonly<Record<string, string | string[] | undefined>>,
  today: ISODate,
): Period {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const from = one("from");
  const to = one("to");
  if (isISODate(from) && isISODate(to) && from <= to && from <= today) {
    const end = to > today ? today : to;
    const limit = addISTDays(from, CUSTOM_MAX_DAYS - 1);
    return { kind: "custom", from, to: end > limit ? limit : end };
  }
  const at = one("at");
  const anchor = isISODate(at) && at <= today ? at : today;
  return one("period") === "month" ? monthOf(anchor) : weekOf(anchor);
}

/** The period just before, the same kind and length ("last period beside it"). */
export function previousPeriod(period: Period): Period {
  if (period.kind === "week") return weekOf(addISTDays(period.from, -1));
  if (period.kind === "month") return monthOf(addISTDays(period.from, -1));
  const length = days(period);
  return {
    kind: "custom",
    from: addISTDays(period.from, -length),
    to: addISTDays(period.from, -1),
  };
}

/** The period after, or null when it would start after today (the pager's forward arrow). */
export function nextPeriod(period: Period, today: ISODate): Period | null {
  if (period.kind === "custom") return null;
  const start = addISTDays(period.to, 1);
  if (start > today) return null;
  return period.kind === "week" ? weekOf(start) : monthOf(start);
}

/** "This week", "Week of 28 Sep", "October 2026", "1 Oct – 15 Oct". */
export function periodLabel(period: Period, today: ISODate): string {
  const day = (date: ISODate, pattern: string) => formatIST(istDayStart(date), pattern);
  if (period.kind === "week") {
    return period.from === weekOf(today).from
      ? "This week"
      : `Week of ${day(period.from, "d MMM")}`;
  }
  if (period.kind === "month") {
    return period.from === monthOf(today).from ? "This month" : day(period.from, "MMMM yyyy");
  }
  return `${day(period.from, "d MMM")} – ${day(period.to, "d MMM")}`;
}

/** The address of a period on /reports (a view control: written with replace). */
export function periodHref(period: Period): string {
  if (period.kind === "custom") return `/reports?from=${period.from}&to=${period.to}`;
  return `/reports?period=${period.kind}&at=${period.from}`;
}

// The facts and the numbers ----------------------------------------------------------------------------

export type ReportFacts = {
  submissions: { taskId: string; at: string; primaryOwnerId: string }[];
  reviews: {
    taskId: string;
    step: "admin" | "owner";
    decision: "approved" | "rejected";
    reviewerId: string;
    at: string;
    handedInAt: string | null;
    primaryOwnerId: string;
  }[];
  notes: { taskId: string; memberId: string; assignedAt: string; acknowledgedAt: string }[];
};

/** A value per engagement: the employees' and the freelancers'. */
export type Split<T> = Record<Engagement, T>;

export type ReworkValue = { sentBack: number; handedIn: number };

const HOUR = 3_600_000;

function inPeriod(instant: string, period: Pick<Period, "from" | "to">): boolean {
  const date = toISTDate(instant);
  return date >= period.from && date <= period.to;
}

/** The median of a list, null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function split<T>(make: () => T): Split<T> {
  return { permanent: make(), freelance: make() };
}

/**
 * **Rework** (PRODUCT §4.13): hand-ins sent back as *changes requested* ÷ hand-ins, in the period,
 * by the engagement of the task's primary owner (whose hand-in it is).
 */
export function rework(
  facts: ReportFacts,
  period: Pick<Period, "from" | "to">,
  engagementOf: (memberId: string) => Engagement,
): Split<ReworkValue> {
  const result = split<ReworkValue>(() => ({ sentBack: 0, handedIn: 0 }));
  for (const s of facts.submissions) {
    if (inPeriod(s.at, period)) result[engagementOf(s.primaryOwnerId)].handedIn += 1;
  }
  for (const r of facts.reviews) {
    if (r.decision === "rejected" && inPeriod(r.at, period)) {
      result[engagementOf(r.primaryOwnerId)].sentBack += 1;
    }
  }
  return result;
}

/**
 * **My turnaround**: the median hours from a task's Done (the hand-in reviewed) to **this Admin's
 * own** approval, in the period. The only KPI about the Admin.
 */
export function turnaround(
  facts: ReportFacts,
  period: Pick<Period, "from" | "to">,
  reviewerId: string,
  engagementOf: (memberId: string) => Engagement,
): Split<number | null> {
  const hours = split<number[]>(() => []);
  for (const r of facts.reviews) {
    if (r.reviewerId !== reviewerId || r.decision !== "approved" || !r.handedInAt) continue;
    if (!inPeriod(r.at, period)) continue;
    hours[engagementOf(r.primaryOwnerId)].push(
      (Date.parse(r.at) - Date.parse(r.handedInAt)) / HOUR,
    );
  }
  return { permanent: median(hours.permanent), freelance: median(hours.freelance) };
}

/**
 * **Acknowledgement lag**: the median hours from assignment to "Task Noted", for the notes tapped
 * in the period, by the engagement of the person the task was given to.
 */
export function acknowledgementLag(
  facts: ReportFacts,
  period: Pick<Period, "from" | "to">,
  engagementOf: (memberId: string) => Engagement,
): Split<number | null> {
  const hours = split<number[]>(() => []);
  for (const n of facts.notes) {
    if (!inPeriod(n.acknowledgedAt, period)) continue;
    hours[engagementOf(n.memberId)].push(
      Math.max(0, Date.parse(n.acknowledgedAt) - Date.parse(n.assignedAt)) / HOUR,
    );
  }
  return { permanent: median(hours.permanent), freelance: median(hours.freelance) };
}

/** An open task as the report reads it. */
export type OpenTask = {
  id: string;
  state: string;
  dueAt: string;
  primaryOwnerId: string;
  /** Active assignees. */
  assigneeIds: readonly string[];
};

const FINAL = ["completed", "cancelled"];

/** **Overdue now**: open tasks past their deadline, by the primary owner's engagement. */
export function overdueNow(
  open: readonly OpenTask[],
  now: Date,
  engagementOf: (memberId: string) => Engagement,
): Split<number> {
  const result = split(() => 0);
  for (const task of open) {
    if (!FINAL.includes(task.state) && Date.parse(task.dueAt) < now.getTime()) {
      result[engagementOf(task.primaryOwnerId)] += 1;
    }
  }
  return result;
}

export type LoadRow = { memberId: string; open: number; overdue: number };

/**
 * **Who is loaded this week** (a list, never a rating): per person on open work, the open tasks
 * due by the end of this IST week (overdue ones included) and how many of them are overdue, from
 * the tasks the viewer sees. Most loaded first, then by name; split by engagement.
 */
export function loadThisWeek(
  open: readonly OpenTask[],
  today: ISODate,
  now: Date,
  engagementOf: (memberId: string) => Engagement,
  nameOf: (memberId: string) => string,
): Split<LoadRow[]> {
  const weekEnd = weekOf(today).to;
  const rows = new Map<string, LoadRow>();
  for (const task of open) {
    if (FINAL.includes(task.state) || toISTDate(task.dueAt) > weekEnd) continue;
    const overdue = Date.parse(task.dueAt) < now.getTime();
    for (const memberId of task.assigneeIds) {
      const row = rows.get(memberId) ?? { memberId, open: 0, overdue: 0 };
      row.open += 1;
      if (overdue) row.overdue += 1;
      rows.set(memberId, row);
    }
  }
  const result = split<LoadRow[]>(() => []);
  for (const row of rows.values()) result[engagementOf(row.memberId)].push(row);
  for (const engagement of ENGAGEMENTS) {
    result[engagement].sort(
      (a, b) => b.open - a.open || nameOf(a.memberId).localeCompare(nameOf(b.memberId)),
    );
  }
  return result;
}

// Words ---------------------------------------------------------------------------------------------

/** "2 of 10 sent back (20%)", "None handed in". */
export function reworkWords({ sentBack, handedIn }: ReworkValue): string {
  if (handedIn === 0) return sentBack > 0 ? `${sentBack} sent back` : "None handed in";
  return `${sentBack} of ${handedIn} sent back (${Math.round((sentBack / handedIn) * 100)}%)`;
}

/** "3.5 h", "2 days", "No data". */
export function hoursWords(hours: number | null): string {
  if (hours === null) return "No data";
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}

export function countWords(count: number): string {
  return count === 1 ? "1 task" : `${count} tasks`;
}

export function loadWords({ open, overdue }: LoadRow): string {
  const openWords = open === 1 ? "1 open" : `${open} open`;
  return overdue > 0 ? `${openWords} · ${overdue} overdue` : openWords;
}
