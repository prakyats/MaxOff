import { formatRupees } from "@/core/lib/rupees";
import { formatIST, istDayStart } from "@/core/time";

import { amountText, priceText } from "./billing";
import { CORRECTION_NOTE_MAX_LENGTH, CORRECTION_NOTE_MIN_LENGTH } from "./month-close";
import type {
  ChangeCause,
  LineChange,
  MonthCloseRead,
  SnapshotVersion,
  TotalChange,
  TotalKey,
  WaitingList,
} from "./month-close";

/**
 * The close screen's words (v3.5 U4; PRODUCT §4.13, WORKFLOWS §7.1 and §7.2): the waiting list in
 * plain words, the close button ("Close September with 4 things still waiting"), the versions'
 * lines ("Closed 3 Oct · v1", "Corrected: ‹note›") and "Changed since close" with before → after
 * amounts. Pure, and **Owner only**: the changes carry amounts (invariant 2).
 */

/** "2026-09" → "2026-09-01"; anything else is not a month (the route answers Not found). */
export function parseCloseMonth(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return `${value}-01`;
}

/** The close screen's address for a month (any of its dates). */
export function closeHref(month: string): string {
  return `/reports/close/${month.slice(0, 7)}`;
}

/** The Revenue page's address for a month (`?month=YYYY-MM`). */
export function revenueMonthHref(month: string): string {
  return `/reports/revenue?month=${month.slice(0, 7)}`;
}

/** "September": the month alone, as the close button says it (decision 16). */
export function shortMonthName(month: string): string {
  return formatIST(istDayStart(`${month.slice(0, 7)}-01`), "MMMM");
}

/** "3 Oct": the day of an instant, in IST. */
export function closeDay(instant: string): string {
  return formatIST(instant, "d MMM");
}

// --- The waiting list (WORKFLOWS §7.2) ---------------------------------------------------------

type WaitingKey = Exclude<keyof WaitingList, "total" | "claimsUntil" | "claimsOpen">;

/**
 * The kinds in the order WORKFLOWS §7.2 lists them: what each counts in one line, and where it is
 * settled (the Owner's Approvals for the people's requests and claims, the deliverables lists for
 * client work, the month's Revenue page for amounts and completions).
 */
const WAITING_KINDS: readonly {
  key: WaitingKey;
  label: string;
  meaning: string;
  href: (month: string) => string;
}[] = [
  {
    key: "attendance",
    label: "Attendance",
    meaning: "Days still waiting for your decision.",
    href: () => "/approvals",
  },
  {
    key: "leave",
    label: "Leave",
    meaning: "Leave requests not decided yet.",
    href: () => "/approvals",
  },
  {
    key: "leavingEarly",
    label: "Leaving early",
    meaning: "Requests to leave early that were never answered.",
    href: () => "/approvals",
  },
  {
    key: "extraWork",
    label: "Extra work",
    meaning: "Extra work notes not decided yet.",
    href: () => "/approvals",
  },
  {
    key: "expenseClaims",
    label: "Expense claims",
    meaning: "Claims not approved or rejected yet.",
    href: () => "/approvals",
  },
  {
    key: "openWork",
    label: "Open work",
    meaning: "Deliverables neither done nor closed.",
    href: () => "/clients/items",
  },
  {
    key: "carryDecisions",
    label: "Carry decisions",
    meaning: "Ended cycles with deliverables not carried, closed or left pending yet.",
    href: () => "/clients/items/decide",
  },
  {
    key: "noAmount",
    label: "No amount set",
    meaning: "Cycles and projects of the month without an amount.",
    href: revenueMonthHref,
  },
  {
    key: "readyToComplete",
    label: "Ready to complete",
    meaning: "One-time projects with every deliverable done, not completed yet.",
    href: revenueMonthHref,
  },
];

export type WaitingRow = {
  key: WaitingKey;
  label: string;
  meaning: string;
  count: number;
  href: string;
};

/** The kinds with something waiting, in §7.2's order; a kind at 0 is left out. */
export function waitingRows(waiting: WaitingList, month: string): WaitingRow[] {
  return WAITING_KINDS.filter((kind) => waiting[kind.key] > 0).map((kind) => ({
    key: kind.key,
    label: kind.label,
    meaning: kind.meaning,
    count: waiting[kind.key],
    href: kind.href(month),
  }));
}

/** "Close September", or "Close September with 4 things still waiting" (decision 16). */
export function closeButtonLabel(month: string, total: number): string {
  const name = `Close ${shortMonthName(month)}`;
  if (total <= 0) return name;
  return `${name} with ${total} ${total === 1 ? "thing" : "things"} still waiting`;
}

/** "Expense claims for September can still be added until 5 Oct." (decision 16), or null. */
export function claimsLine(waiting: WaitingList, month: string): string | null {
  if (!waiting.claimsOpen) return null;
  const until = formatIST(istDayStart(waiting.claimsUntil), "d MMM");
  return `Expense claims for ${shortMonthName(month)} can still be added until ${until}.`;
}

// --- The versions (decision 18) ------------------------------------------------------------------

/** "Closed 3 Oct · v1" (the first close's day, the latest version), or null for an open month. */
export function closedLine(versions: readonly Pick<SnapshotVersion, "version" | "closedAt">[]) {
  const first = versions.find((version) => version.version === 1) ?? versions[0];
  const latest = versions.reduce<number>((top, version) => Math.max(top, version.version), 0);
  if (!first || latest === 0) return null;
  return `Closed ${closeDay(first.closedAt)} · v${latest}`;
}

export type VersionRow = {
  id: string;
  /** "v1 · Closed 3 Oct" or "v2 · Corrected 5 Oct". */
  title: string;
  /** "Corrected: ‹note›" on a correction, null on v1. */
  note: string | null;
  /** "By ‹name›", or null when the name is not known. */
  by: string | null;
};

/** Every version, newest first (the latest is the one the month shows). */
export function versionRows(versions: readonly SnapshotVersion[]): VersionRow[] {
  return [...versions]
    .sort((a, b) => b.version - a.version)
    .map((version) => ({
      id: version.id,
      title: `v${version.version} · ${version.version === 1 ? "Closed" : "Corrected"} ${closeDay(version.closedAt)}`,
      note: version.version === 1 || !version.note ? null : `Corrected: ${version.note}`,
      by: version.closedByName ? `By ${version.closedByName}` : null,
    }));
}

// --- "Changed since close" (decision 18; v3.5 Q6) ------------------------------------------------

const CAUSE_WORDS: Record<ChangeCause["action"], string> = {
  done: "Marked done",
  reopened: "Reopened",
  sent_back: "Sent back",
  cancelled: "Cancelled",
  closed: "Closed",
};

const LINE_FIGURE_LABELS = {
  amount: "Amount",
  potential: "Potential",
  achieved: "Achieved",
  remaining: "Remaining",
  closed_not_achieved: "Closed, not achieved",
} as const;

const TOTAL_LABELS: Record<TotalKey, string> = {
  potential: "Potential",
  achieved: "Achieved",
  remaining: "Remaining",
  closed_not_achieved: "Closed, not achieved",
  advances_received: "Advances received",
  advances_returned: "Advances returned",
};

export type ChangeRow = {
  key: string;
  /** The line in plain words: "Reel 3 · Monthly posts". */
  what: string;
  /** Who changed it ("Reopened by Ravi"), else what happened ("Amount changed", "Figures changed"). */
  detail: string;
  /** Each moved figure, before → after: "Achieved ₹6,000 → ₹4,000". */
  figures: string[];
};

/** One figure's move; the missing side of an added or removed line is left out. */
function move(label: string, before: string | null, after: string | null): string {
  if (before === null) return `${label} ${after ?? ""}`.trim();
  if (after === null) return `${label} was ${before}`;
  return `${label} ${before} → ${after}`;
}

function detailOf(change: LineChange): string {
  if (change.cause) {
    const words = CAUSE_WORDS[change.cause.action];
    return change.cause.byName ? `${words} by ${change.cause.byName}` : words;
  }
  if (change.kind === "added") return "Added since the close";
  if (change.kind === "removed") return "No longer in the month";
  return amountMoved(change) ? "Amount changed" : "Figures changed";
}

/**
 * Whether the line's own amount moved (a cycle's or one-time project's amount, a deliverable's
 * value, an advance's amount): "Amount changed". A line where only Potential, Achieved, Remaining
 * or the counts moved (a reopened deliverable's cycle) says "Figures changed" (U7 review).
 */
function amountMoved(change: LineChange): boolean {
  if (!change.before || !change.after) return false;
  switch (change.line) {
    case "cycle":
    case "project":
      return change.before.amount !== change.after.amount;
    case "item":
      return change.before.value !== change.after.value;
    case "advance_received":
    case "advance_returned":
      return change.before.amount !== change.after.amount;
  }
}

function figuresOf(change: LineChange): string[] {
  if (change.line === "cycle" || change.line === "project") {
    const { before, after } = change;
    return (Object.keys(LINE_FIGURE_LABELS) as (keyof typeof LINE_FIGURE_LABELS)[]).flatMap(
      (key) => {
        const was = before ? before[key] : undefined;
        const now = after ? after[key] : undefined;
        if (before && after && was === now) return [];
        // An added or removed line shows its amount and Potential only, not every zero.
        if ((!before || !after) && key !== "amount" && key !== "potential") return [];
        const text = (value: number | null | undefined) =>
          value === undefined
            ? null
            : key === "amount"
              ? amountText(value)
              : formatRupees(value ?? 0);
        return [move(LINE_FIGURE_LABELS[key], text(was), text(now))];
      },
    );
  }
  if (change.line === "item") {
    const { before, after } = change;
    const figures: string[] = [];
    if (!before || !after || before.value !== after.value) {
      figures.push(
        move(
          "Value",
          before ? priceText(before.value) : null,
          after ? priceText(after.value) : null,
        ),
      );
    }
    const counted = (side: typeof before) =>
      side ? formatRupees(side.achieved ? (side.value ?? 0) : 0) : null;
    if (!before || !after || before.achieved !== after.achieved) {
      figures.push(move("Achieved", counted(before), counted(after)));
    }
    if (before && after && before.in_potential !== after.in_potential) {
      figures.push(after.in_potential ? "Now in Potential" : "No longer in Potential");
    }
    if (before && after && before.closed_not_achieved !== after.closed_not_achieved) {
      figures.push(after.closed_not_achieved ? "Closed, not achieved" : "No longer closed");
    }
    return figures;
  }
  if (change.line === "advance_received" || change.line === "advance_returned") {
    const label = change.line === "advance_received" ? "Received" : "Returned";
    return [
      move(
        label,
        change.before ? formatRupees(change.before.amount) : null,
        change.after ? formatRupees(change.after.amount) : null,
      ),
    ];
  }
  return [];
}

/** "Changed since close" as rows, in the read's order (cycle, deliverable, project, advance). */
export function changeRows(lines: readonly LineChange[]): ChangeRow[] {
  return lines.map((change) => ({
    key: `${change.line}:${change.id}`,
    what: change.what,
    detail: detailOf(change),
    figures: figuresOf(change),
  }));
}

/** The month's totals that moved: "Achieved ₹10,000 → ₹5,000". */
export function totalRows(totals: readonly TotalChange[]): { key: TotalKey; text: string }[] {
  return totals.map((total) => ({
    key: total.key,
    text: move(
      TOTAL_LABELS[total.key],
      total.before === null ? null : formatRupees(total.before),
      total.after === null ? null : formatRupees(total.after),
    ),
  }));
}

// --- The correction note (WORKFLOWS §7.4 "As built (U3)") ----------------------------------------

/** The note's rule said before the request, in the function's own words; null when it is fine. */
export function noteProblem(note: string): string | null {
  const length = note.trim().length;
  return length < CORRECTION_NOTE_MIN_LENGTH || length > CORRECTION_NOTE_MAX_LENGTH
    ? `Write a note of ${CORRECTION_NOTE_MIN_LENGTH} to ${CORRECTION_NOTE_MAX_LENGTH} characters.`
    : null;
}

// --- The screen's state --------------------------------------------------------------------------

export type MonthCloseView =
  | { state: "open"; waiting: WaitingRow[]; total: number; claims: string | null; button: string }
  | { state: "cannot"; message: string }
  | {
      state: "closed";
      closed: string;
      versions: VersionRow[];
      changes: ChangeRow[];
      totals: { key: TotalKey; text: string }[];
      nextVersion: number;
    };

/** What the close screen shows for the read. */
export function monthCloseView(read: MonthCloseRead): MonthCloseView {
  if (read.closed) {
    const latest = read.versions.reduce<number>((top, v) => Math.max(top, v.version), 0);
    return {
      state: "closed",
      closed: closedLine(read.versions) ?? "Closed",
      versions: versionRows(read.versions),
      changes: changeRows(read.changedSinceClose?.lines ?? []),
      totals: totalRows(read.changedSinceClose?.totals ?? []),
      nextVersion: latest + 1,
    };
  }
  if (!read.canClose || !read.waiting) {
    return { state: "cannot", message: read.cannotClose?.message ?? "Nothing to close." };
  }
  return {
    state: "open",
    waiting: waitingRows(read.waiting, read.month),
    total: read.waiting.total,
    claims: claimsLine(read.waiting, read.month),
    button: closeButtonLabel(read.month, read.waiting.total),
  };
}

/** The Revenue page's link in the month header, for an ended month (v3.5 Q11). */
export type CloseLink = { href: string; label: string; closed: boolean };

/**
 * "Closed 3 Oct · v1" for a closed month; "Close month" for an ended one from the organization's
 * first priced month on (`firstPricedMonth`, its 1st); null before it, or when nothing is priced
 * yet, whose close screen would only say "Nothing to close." (WORKFLOWS §7.1, Q2; U7 review).
 */
export function closeLink(
  month: string,
  versions: readonly Pick<SnapshotVersion, "version" | "closedAt">[],
  firstPricedMonth: string | null,
): CloseLink | null {
  const closed = closedLine(versions);
  if (closed) return { href: closeHref(month), label: closed, closed: true };
  if (firstPricedMonth === null || month.slice(0, 7) < firstPricedMonth.slice(0, 7)) return null;
  return { href: closeHref(month), label: "Close month", closed: false };
}
