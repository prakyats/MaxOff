import { formatRupees } from "@/core/lib/rupees";

import {
  amountText,
  BILLING_CATEGORIES,
  BILLING_CATEGORY_LABELS,
  type BillingCategory,
  isBillingCategory,
  monthName,
  shortDay,
} from "./billing";

/**
 * The Owner's Revenue page (9.2, v2.1 "Money in"; WORKFLOWS §6, DATA-MODEL §7): what the one read
 * (`revenue_month_read`) answers for one IST month, in the app's own names, and everything the
 * page works out from it: the month's totals, the lines grouped by client, what needs a look,
 * the category filter and the month switcher. Pure, and **Owner only**: nothing here is ever in
 * an Admin's or a Crew member's payload (invariant 2).
 *
 * Sums are made in **paise as integers**, so a column of amounts adds up exactly.
 */

/** A retainer's cycle that starts in the month. */
export type CycleLine = {
  kind: "cycle";
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  cycleId: string;
  /** "November 2026", "Week of 16 Nov"; null when the cycle has no label. */
  label: string | null;
  category: BillingCategory;
  /** The cycle's own amount; null = "No amount set". */
  amount: number | null;
  potential: number;
  achieved: number;
  remaining: number;
  closedNotAchieved: number;
  /** What the priced additions add on top of the amount. */
  addedValue: number;
  addedCount: number;
  /** Additions still waiting for a price. */
  notPricedCount: number;
  planCount: number;
  doneCount: number;
  held: boolean;
};

/** A one-time project sitting in the month: one lump sum. */
export type ProjectLine = {
  kind: "project";
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  category: BillingCategory;
  state: "open" | "in_progress" | "completed" | "cancelled";
  deliveryDate: string | null;
  /** The lump sum; null = "No amount set". */
  amount: number | null;
  potential: number;
  achieved: number;
  /** Potential − Achieved (WORKFLOWS §6), never below zero. */
  remaining: number;
  closedNotAchieved: number;
  wasDue: boolean;
  readyToComplete: boolean;
  held: boolean;
  /** Advances received and not returned, over the project's life. */
  advancesKept: number;
};

export type RevenueLine = CycleLine | ProjectLine;

/** An advance received, or returned, in the month. Never Achieved. */
export type AdvanceEvent = {
  advanceId: string;
  event: "received" | "returned";
  onDate: string;
  amount: number;
  projectId: string;
};

export type RevenueMonth = {
  /** The month shown: its first day (IST). */
  month: string;
  /** This IST month's first day. */
  thisMonth: string;
  /** The months that have revenue lines, oldest first. */
  months: string[];
  lines: RevenueLine[];
  advances: AdvanceEvent[];
};

export type Totals = {
  potential: number;
  achieved: number;
  remaining: number;
  closedNotAchieved: number;
};

type Json = Record<string, unknown>;

function record(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The revenue read's ${what} is missing.`);
  }
  return value as Json;
}

function rows(value: unknown): Json[] {
  return Array.isArray(value) ? value.map((row) => record(row, "row")) : [];
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`The revenue read's ${what} is missing.`);
  return value;
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** A `numeric` arrives as a JSON number (or a string from an older driver); null stays null. */
function amountOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  // The message never repeats the value: an error report carries no money (ARCHITECTURE §18.2).
  if (!Number.isFinite(amount)) {
    throw new Error("The revenue read holds an amount that is not one.");
  }
  return amount;
}

const amount = (value: unknown): number => amountOrNull(value) ?? 0;

const count = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

const PROJECT_STATES = ["open", "in_progress", "completed", "cancelled"] as const;

function projectState(value: unknown): ProjectLine["state"] {
  const state = PROJECT_STATES.find((known) => known === value);
  if (!state) throw new Error("The revenue read holds a project state MaxOff does not know.");
  return state;
}

/** Rupees as whole paise. */
const paise = (rupees: number): number => Math.round(rupees * 100);

/** The read's JSON (snake_case, DATA-MODEL §7) as the page's own shape. */
export function toRevenueMonth(value: unknown): RevenueMonth {
  const read = record(value, "answer");
  const cycles = rows(read.cycles).map((row): CycleLine => ({
    kind: "cycle",
    clientId: text(row.client_id, "client"),
    clientName: text(row.client_name, "client name"),
    projectId: text(row.project_id, "project"),
    projectName: text(row.project_name, "project name"),
    cycleId: text(row.cycle_id, "cycle"),
    label: textOrNull(row.label),
    category: isBillingCategory(row.category) ? row.category : "retainer",
    amount: amountOrNull(row.amount),
    potential: amount(row.potential),
    achieved: amount(row.achieved),
    remaining: amount(row.remaining),
    closedNotAchieved: amount(row.closed_not_achieved),
    addedValue: amount(row.added_value),
    addedCount: count(row.added_count),
    notPricedCount: count(row.not_priced_count),
    planCount: count(row.plan_count),
    doneCount: count(row.done_count),
    held: row.held === true,
  }));
  const projects = rows(read.projects).map((row): ProjectLine => {
    const potential = amount(row.potential);
    const achieved = amount(row.achieved);
    return {
      kind: "project",
      clientId: text(row.client_id, "client"),
      clientName: text(row.client_name, "client name"),
      projectId: text(row.project_id, "project"),
      projectName: text(row.project_name, "project name"),
      category: isBillingCategory(row.category) ? row.category : "project",
      state: projectState(row.state),
      deliveryDate: textOrNull(row.delivery_date),
      amount: amountOrNull(row.amount),
      potential,
      achieved,
      remaining: Math.max(paise(potential) - paise(achieved), 0) / 100,
      closedNotAchieved: amount(row.closed_not_achieved),
      wasDue: row.was_due === true,
      readyToComplete: row.ready_to_complete === true,
      held: row.held === true,
      advancesKept: amount(row.advances_kept),
    };
  });
  return {
    month: text(read.month, "month"),
    thisMonth: text(read.this_month, "current month"),
    months: Array.isArray(read.months)
      ? read.months.filter((month): month is string => typeof month === "string").sort()
      : [],
    lines: [...cycles, ...projects],
    advances: rows(read.advances).map((row) => ({
      advanceId: text(row.advance_id, "advance"),
      event: row.event === "returned" ? "returned" : "received",
      onDate: text(row.on_date, "advance date"),
      amount: amount(row.amount),
      projectId: text(row.project_id, "advance project"),
    })),
  };
}

// --- The address: ?month=YYYY-MM and ?category= ------------------------------------------------

/** The filter's choices: every category, or one. */
export const CATEGORY_FILTERS = ["all", ...BILLING_CATEGORIES] as const;
export type CategoryFilter = (typeof CATEGORY_FILTERS)[number];

export const CATEGORY_FILTER_LABELS: Record<CategoryFilter, string> = {
  all: "All",
  ...BILLING_CATEGORY_LABELS,
};

/** `?category=`: anything that is not a category is "all". */
export function parseCategory(value: unknown): CategoryFilter {
  return isBillingCategory(value) ? value : "all";
}

/** `?month=YYYY-MM` as that month's first day; null (the read then takes this IST month). */
export function parseMonth(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return `${value}-01`;
}

/** The first day of the month `by` months away, in plain calendar arithmetic (no clock). */
export function shiftMonth(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + by;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** The page's address for a month and a category; this month and "all" are left out. */
export function revenueHref(
  view: { month: string; category: CategoryFilter },
  thisMonth: string,
): string {
  const query = new URLSearchParams();
  if (view.month.slice(0, 7) !== thisMonth.slice(0, 7)) query.set("month", view.month.slice(0, 7));
  if (view.category !== "all") query.set("category", view.category);
  const text = query.toString();
  return text ? `/reports/revenue?${text}` : "/reports/revenue";
}

/**
 * The month switcher: the month before and after, within the months that hold anything (and
 * this month, always reachable). Null at either end.
 */
export function monthSwitcher(read: Pick<RevenueMonth, "month" | "thisMonth" | "months">): {
  label: string;
  previous: string | null;
  next: string | null;
} {
  const known = [...read.months, read.thisMonth].sort();
  const first = known[0] ?? read.thisMonth;
  const last = known[known.length - 1] ?? read.thisMonth;
  return {
    label: monthName(read.month),
    previous: read.month > first ? shiftMonth(read.month, -1) : null,
    next: read.month < last ? shiftMonth(read.month, 1) : null,
  };
}

// --- Totals, the filter, the groups ------------------------------------------------------------

export function filterLines(lines: readonly RevenueLine[], filter: CategoryFilter): RevenueLine[] {
  return filter === "all" ? [...lines] : lines.filter((line) => line.category === filter);
}

/** Potential · Achieved · Remaining · Closed, not achieved over some lines, summed in paise. */
export function totalsOf(lines: readonly RevenueLine[]): Totals {
  const sum = (pick: (line: RevenueLine) => number) =>
    lines.reduce((total, line) => total + paise(pick(line)), 0) / 100;
  return {
    potential: sum((line) => line.potential),
    achieved: sum((line) => line.achieved),
    remaining: sum((line) => line.remaining),
    closedNotAchieved: sum((line) => line.closedNotAchieved),
  };
}

/**
 * "Advances received" in the month and what was returned in it, apart from Achieved. Under a
 * category filter, only the advances of the projects that are among the lines shown.
 */
export function advanceTotals(
  advances: readonly AdvanceEvent[],
  lines?: readonly RevenueLine[],
): { received: number; returned: number } {
  const shown = lines ? new Set(lines.map((line) => line.projectId)) : null;
  const sum = (event: AdvanceEvent["event"]) =>
    advances
      .filter((advance) => advance.event === event && (!shown || shown.has(advance.projectId)))
      .reduce((total, advance) => total + paise(advance.amount), 0) / 100;
  return { received: sum("received"), returned: sum("returned") };
}

export type ClientGroup = {
  clientId: string;
  clientName: string;
  totals: Totals;
  lines: RevenueLine[];
};

const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

/** One group per client, by name; inside, by project name, a retainer's cycles in the read's order. */
export function groupByClient(lines: readonly RevenueLine[]): ClientGroup[] {
  const groups = new Map<string, RevenueLine[]>();
  for (const line of lines) {
    const list = groups.get(line.clientId);
    if (list) list.push(line);
    else groups.set(line.clientId, [line]);
  }
  return [...groups.values()]
    .map((list) => {
      // A stable sort: cycles of one project keep the read's order (by period).
      const sorted = [...list].sort((a, b) => byName(a.projectName, b.projectName));
      const first = sorted[0]!;
      return {
        clientId: first.clientId,
        clientName: first.clientName,
        totals: totalsOf(sorted),
        lines: sorted,
      };
    })
    .sort((a, b) => byName(a.clientName, b.clientName) || a.clientId.localeCompare(b.clientId));
}

// --- What a line says ---------------------------------------------------------------------------

/** The project page a line opens: a retainer at that cycle, at its Billing section. */
export function lineHref(line: RevenueLine): string {
  const base = `/clients/${line.clientId}/projects/${line.projectId}`;
  return `${base}${line.kind === "cycle" ? `?cycle=${line.cycleId}` : ""}#project-billing`;
}

/** A stable key for a line. */
export const lineKey = (line: RevenueLine): string =>
  line.kind === "cycle" ? `cycle:${line.cycleId}` : `project:${line.projectId}`;

/** "November 2026 · 4 of 12 done", or a one-time project's "Due 15 Nov" / "Completed" / … */
export function lineStatus(line: RevenueLine): string {
  if (line.kind === "cycle") {
    const total = line.planCount + line.addedCount;
    const done = `${line.doneCount} of ${total} done`;
    return line.label ? `${line.label} · ${done}` : done;
  }
  if (line.state === "cancelled") return "Cancelled · closed, not achieved";
  if (line.state === "completed") return "Completed";
  const parts = [
    line.deliveryDate
      ? `${line.wasDue ? "Was due" : "Due"} ${shortDay(line.deliveryDate)}`
      : "No delivery date",
    line.readyToComplete ? "Ready to complete" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The quiet extras under a line: "+₹2,718 added", "2 not priced", "Advance ₹30,000". */
export function lineNotes(line: RevenueLine): string[] {
  if (line.kind === "cycle") {
    return [
      line.addedValue > 0 ? `+${formatRupees(line.addedValue)} added` : null,
      line.notPricedCount > 0 ? `${line.notPricedCount} not priced` : null,
    ].filter((note): note is string => note !== null);
  }
  return line.advancesKept > 0 ? [`Advance ${formatRupees(line.advancesKept)}`] : [];
}

/**
 * A line's own figure: "No amount set" without an amount, "Not billable" for ₹0 with nothing on
 * top, else its Potential.
 */
export function lineFigure(line: RevenueLine): string {
  if (line.amount === null && line.potential === 0) return amountText(null);
  if (line.amount === 0 && line.potential === 0) return amountText(0);
  return formatRupees(line.potential);
}

// --- Needs a look --------------------------------------------------------------------------------

export type ExceptionKind = "no_amount" | "not_priced" | "ready_to_complete" | "was_due";

export type RevenueException = {
  key: string;
  kind: ExceptionKind;
  /** "No amount set", "2 not priced", "Ready to complete", "Was due 15 Nov". */
  text: string;
  /** "Client · Project". */
  where: string;
  href: string;
};

const EXCEPTION_ORDER: ExceptionKind[] = [
  "no_amount",
  "not_priced",
  "ready_to_complete",
  "was_due",
];

/** What the Owner should look at this month: each a line that names its client and project. */
export function exceptionsOf(lines: readonly RevenueLine[]): RevenueException[] {
  const found: (RevenueException & { client: string; project: string })[] = [];
  for (const line of lines) {
    const add = (kind: ExceptionKind, words: string) =>
      found.push({
        key: `${kind}:${lineKey(line)}`,
        kind,
        text: words,
        where: `${line.clientName} · ${line.projectName}${
          line.kind === "cycle" && line.label ? ` · ${line.label}` : ""
        }`,
        href: lineHref(line),
        client: line.clientName,
        project: line.projectName,
      });
    if (line.amount === null) add("no_amount", "No amount set");
    if (line.kind === "cycle") {
      if (line.notPricedCount > 0) add("not_priced", `${line.notPricedCount} not priced`);
    } else {
      if (line.readyToComplete) add("ready_to_complete", "Ready to complete");
      if (line.wasDue && line.deliveryDate) {
        add("was_due", `Was due ${shortDay(line.deliveryDate)}`);
      }
    }
  }
  return found
    .sort(
      (a, b) =>
        EXCEPTION_ORDER.indexOf(a.kind) - EXCEPTION_ORDER.indexOf(b.kind) ||
        byName(a.client, b.client) ||
        byName(a.project, b.project) ||
        a.key.localeCompare(b.key),
    )
    .map(({ key, kind, text: words, where, href }) => ({ key, kind, text: words, where, href }));
}

/** Everything the page draws for one month and one category. */
export type RevenueView = {
  filter: CategoryFilter;
  totals: Totals;
  advances: { received: number; returned: number };
  exceptions: RevenueException[];
  clients: ClientGroup[];
  /** Nothing at all in the month under this filter. */
  empty: boolean;
};

export function revenueView(read: RevenueMonth, filter: CategoryFilter): RevenueView {
  const lines = filterLines(read.lines, filter);
  const advances = advanceTotals(read.advances, filter === "all" ? undefined : lines);
  return {
    filter,
    totals: totalsOf(lines),
    advances,
    exceptions: exceptionsOf(lines),
    clients: groupByClient(lines),
    empty: lines.length === 0 && advances.received === 0 && advances.returned === 0,
  };
}
