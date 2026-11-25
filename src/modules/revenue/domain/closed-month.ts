import {
  type BillingStatus,
  type CategoryFilter,
  exceptionsOf,
  filterLines,
  lineKey,
  type RevenueLine,
  type RevenueMonth,
  revenueView,
  type RevenueView,
  toRevenueMonth,
} from "./revenue";

/**
 * A **closed** month on the Revenue page (v3.5 U5; WORKFLOWS §7.1 decisions 10 and 18, v3.5 Q12
 * and Q13): the figures come from the latest snapshot, not the live read, in the same layout. The
 * live read still runs (as for an open month, so the page costs the same): it gives the month
 * switcher, today's names, what still needs a look, the billing status "now", and a cheap
 * "Changed since close" check. Pure, and **Owner only**: the snapshot is money (invariant 2).
 */

/** The latest version's revenue section, as the page reads it (`data->schema`, `data->revenue`). */
export type SnapshotRevenue = { schema: unknown; revenue: unknown };

/**
 * The snapshot's revenue lines in the page's own shape (`toRevenueMonth` reads the stored lines:
 * schema 1's lines are a superset of the live read's), with the live read's month, switcher months
 * and **today's names** (a renamed client, project or cycle is not a change, WORKFLOWS §7.1; a line
 * no longer in the live month keeps its stored names). A shape MaxOff does not read is refused,
 * without repeating any value.
 */
export function closedRevenueMonth(snapshot: SnapshotRevenue, live: RevenueMonth): RevenueMonth {
  if (snapshot.schema !== 1) {
    throw new Error("This snapshot is in a shape MaxOff does not read yet.");
  }
  const revenue =
    typeof snapshot.revenue === "object" && snapshot.revenue !== null ? snapshot.revenue : {};
  const stored = toRevenueMonth({
    ...revenue,
    month: live.month,
    this_month: live.thisMonth,
    months: live.months,
  });
  const clients = new Map(live.lines.map((line) => [line.clientId, line.clientName]));
  const projects = new Map(live.lines.map((line) => [line.projectId, line.projectName]));
  const labels = new Map(
    live.lines.flatMap((line) => (line.kind === "cycle" ? [[line.cycleId, line.label]] : [])),
  );
  return {
    ...stored,
    lines: stored.lines.map((line): RevenueLine => {
      const named = {
        clientName: clients.get(line.clientId) ?? line.clientName,
        projectName: projects.get(line.projectId) ?? line.projectName,
      };
      return line.kind === "cycle"
        ? {
            ...line,
            ...named,
            label: labels.has(line.cycleId) ? (labels.get(line.cycleId) ?? null) : line.label,
          }
        : { ...line, ...named };
    }),
  };
}

const paise = (rupees: number | null): number | null =>
  rupees === null ? null : Math.round(rupees * 100);

/** A line's figures as the page shows them, for the comparison (never a name, never a status). */
function figuresOf(line: RevenueLine): (number | null)[] {
  const common = [
    paise(line.amount),
    paise(line.potential),
    paise(line.achieved),
    paise(line.remaining),
    paise(line.closedNotAchieved),
  ];
  return line.kind === "cycle"
    ? [...common, line.planCount, line.addedCount, line.doneCount]
    : common;
}

/**
 * The Revenue page's cheap "Changed since close" (v3.5 U5): whether the live read's lines differ
 * from the snapshot's, by stable id (a cycle, a one-time project, an advance received or returned)
 * and figures only: amount, Potential, Achieved, Remaining, Closed not achieved, and a cycle's
 * planned, added and done counts. Every difference found here is one the close screen's full
 * comparison (`app.month_revenue_changes`) also finds, so the line never shows when the close
 * screen would say nothing moved. A change inside a cycle that moves none of these (two open
 * deliverables' prices swapped, a ₹0 deliverable closed) is left to the close screen, which
 * rebuilds the month in full; the Revenue page never pays for that rebuild.
 */
export function changedSinceCloseQuick(stored: RevenueMonth, live: RevenueMonth): boolean {
  const lines = (month: RevenueMonth) =>
    new Map(month.lines.map((line) => [lineKey(line), figuresOf(line).join("|")]));
  const advances = (month: RevenueMonth) =>
    new Map(
      month.advances.map((advance) => [
        `${advance.advanceId}:${advance.event}`,
        String(paise(advance.amount)),
      ]),
    );
  const differ = (a: Map<string, string>, b: Map<string, string>) =>
    a.size !== b.size || [...a].some(([key, value]) => b.get(key) !== value);
  return differ(lines(stored), lines(live)) || differ(advances(stored), advances(live));
}

const STATUS_WORDS: Record<BillingStatus, string> = {
  not_billed: "Not billed",
  billed: "Billed",
};

/**
 * A closed month's line's billing status (decision 10, v3.5 Q13): the status at close, and the one
 * now beside it only when they differ ("Billed at close · Not billed now"); otherwise one status
 * ("Billed"). A line no longer in the live month shows its status at close. Null when the stored
 * line has none.
 */
export function billingStatusText(
  atClose: BillingStatus | null,
  now: BillingStatus | null,
): string | null {
  if (atClose === null) return null;
  if (now === null || now === atClose) return STATUS_WORDS[atClose];
  return `${STATUS_WORDS[atClose]} at close · ${STATUS_WORDS[now]} now`;
}

/** What a closed month's page draws, beyond an open month's view. */
export type ClosedRevenueView = RevenueView & {
  /** The live figures moved since the latest version (the cheap check above). */
  changed: boolean;
  /** Each shown line's billing status, by `lineKey`. */
  billing: Map<string, string>;
};

/**
 * A closed month's view: the totals, groups and lines from the snapshot; **Needs a look** from the
 * live read (it is the Owner's list of what to do today: a "No amount set" fixed since the close is
 * not asked again); the billing status at close and now; and whether anything moved.
 */
export function closedRevenueView(
  stored: RevenueMonth,
  live: RevenueMonth,
  filter: CategoryFilter,
): ClosedRevenueView {
  const view = revenueView(stored, filter);
  const now = new Map(live.lines.map((line) => [lineKey(line), line.billingStatus]));
  const billing = new Map<string, string>();
  for (const line of filterLines(stored.lines, filter)) {
    const text = billingStatusText(line.billingStatus, now.get(lineKey(line)) ?? null);
    if (text) billing.set(lineKey(line), text);
  }
  return {
    ...view,
    exceptions: exceptionsOf(filterLines(live.lines, filter)),
    changed: changedSinceCloseQuick(stored, live),
    billing,
  };
}
