import { formatRupees } from "@/core/lib/rupees";
import { formatDateTime } from "@/core/time";

import { BILLING_CATEGORY_LABELS, isBillingCategory, shortDay } from "./billing";

/**
 * A project's **Billing history** (v2.5 "Revenue every day", kickoff 9 Q7; DATA-MODEL §7): what
 * `project_billing_history` answers (the money tables' own audit rows, newest first), as the lines
 * the Owner reads: when (IST), who, and what happened in plain words ("Amount set to ₹10,000 (was
 * ₹8,000)", "Marked billed on 3 Dec", "Advance ₹30,000 received", "Adjusted to ₹9,000: ‹note›",
 * "Price of ‹title› set to ₹2,000"). Pure, and **Owner only** like everything in this module.
 *
 * A row that says nothing on its own is left out: `billing_started` (the empty billing row, always
 * followed by the category or the amount it was made for) and `override_superseded` (the old
 * adjustment closed by the new one, which is listed).
 */

/** One audit row as the read answers it. */
export type HistoryRow = {
  id: string;
  at: string;
  entity: string;
  action: string;
  actorName: string | null;
  old: Record<string, unknown>;
  new: Record<string, unknown>;
  /** The cycle's label or the deliverable's title the row is about; null for the project. */
  subject: string | null;
};

/** A line of the Billing history. */
export type HistoryEntry = {
  id: string;
  /** "3 Dec 2026, 4:05 pm" (IST). */
  when: string;
  /** Who did it; "MaxOff" for a change no person made (a new cycle copying the amount). */
  who: string;
  what: string;
};

type Json = Record<string, unknown>;

const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/** The read's JSON array as rows; anything that is not a row is refused. */
export function toHistoryRows(value: unknown): HistoryRow[] {
  if (!Array.isArray(value)) throw new Error("The billing history read is missing.");
  return value.map((item) => {
    const row = object(item);
    // `activity_log.id` is a bigint: a JSON number (a string from a driver that keeps it exact).
    const id = typeof row.id === "number" || typeof row.id === "string" ? String(row.id) : null;
    if (id === null || typeof row.at !== "string") {
      throw new Error("The billing history read holds a row without its id or time.");
    }
    return {
      id,
      at: row.at,
      entity: typeof row.entity === "string" ? row.entity : "",
      action: typeof row.action === "string" ? row.action : "",
      actorName: textOrNull(row.actor_name),
      old: object(row.old),
      new: object(row.new),
      subject: textOrNull(row.subject),
    };
  });
}

/** A JSON number (or numeric string) as rupees; null when absent. */
function rupeesOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/** "₹10,000"; null is "No amount set", ₹0 "Not billable" (the section's own words). */
function amountWords(value: number | null): string {
  if (value === null) return "No amount set";
  return value === 0 ? "Not billable" : formatRupees(value);
}

/** " (was ₹8,000)" when there was a figure before and it differs; nothing for a first one. */
function was(old: Json, key: string, now: number | null): string {
  const before = rupeesOrNull(old[key]);
  return before === null || before === now ? "" : ` (was ${amountWords(before)})`;
}

/** "Amount set to ₹10,000 (was ₹8,000)", "Amount removed (was ₹8,000)". */
function amountChange(row: HistoryRow, key: string, prefix: string): string | null {
  if (!(key in row.new)) return null;
  const now = rupeesOrNull(row.new[key]);
  const head = now === null ? `${prefix} removed` : `${prefix} set to ${amountWords(now)}`;
  return `${head}${was(row.old, key, now)}`;
}

/** "November 2026: " before a cycle's line, never on a one-time project's one cycle. */
function about(row: HistoryRow, oneTime: boolean): string {
  return !oneTime && row.subject ? `${row.subject}: ` : "";
}

/** A sentence's first letter upper case (a line led by a cycle's name keeps its own case). */
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * What one audit row says, in plain words; null for a row the history leaves out. `oneTime`: a
 * one-time project, whose single cycle is never named.
 */
export function historyWords(row: HistoryRow, { oneTime }: { oneTime: boolean }): string | null {
  const prefix = about(row, oneTime);
  const lead = (text: string) => (prefix ? `${prefix}${text}` : sentence(text));
  switch (row.entity) {
    case "project_billing": {
      if (row.action === "billing_started") return null;
      if ("billing_category" in row.new) {
        const now = row.new.billing_category;
        const before = row.old.billing_category;
        const label = isBillingCategory(now) ? BILLING_CATEGORY_LABELS[now] : "the default";
        const earlier = isBillingCategory(before)
          ? ` (was ${BILLING_CATEGORY_LABELS[before]})`
          : "";
        return `Category set to ${label}${earlier}`;
      }
      const words =
        amountChange(row, "fixed_amount", "Amount") ?? amountChange(row, "cycle_amount", "Amount");
      return words ?? "Billing changed";
    }
    case "cycle_billing": {
      if (row.action === "billed") {
        const on = textOrNull(row.new.billed_on);
        const note = textOrNull(row.new.note);
        return lead(`marked billed${on ? ` on ${shortDay(on)}` : ""}${note ? `: ${note}` : ""}`);
      }
      if (row.action === "not_billed") return lead("marked not billed");
      const words = amountChange(row, "cycle_amount", "amount");
      if (words) {
        // A new cycle copying the project's amount (no function, no person).
        return lead(row.action === "insert" ? `${words} from the project's amount` : words);
      }
      return lead("billing changed");
    }
    case "item_billing": {
      const title = row.subject ?? "a deliverable";
      if (row.action === "value_cleared") {
        const before = rupeesOrNull(row.old.value);
        return `Price of ${title} cleared${before === null ? "" : ` (was ${amountWords(before)})`}`;
      }
      if (row.action === "value_set") {
        const now = rupeesOrNull(row.new.value);
        return `Price of ${title} set to ${amountWords(now)}${was(row.old, "value", now)}`;
      }
      return null;
    }
    case "project_advances": {
      if (row.action === "advance_recorded") {
        const amount = rupeesOrNull(row.new.amount);
        const on = textOrNull(row.new.received_on);
        const note = textOrNull(row.new.note);
        return `Advance ${amount === null ? "" : `${formatRupees(amount)} `}received${
          on ? ` on ${shortDay(on)}` : ""
        }${note ? `: ${note}` : ""}`;
      }
      if (row.action === "advance_returned") {
        const on = textOrNull(row.new.returned_on);
        const note = textOrNull(row.new.return_note);
        return `Advance returned${on ? ` on ${shortDay(on)}` : ""}${note ? `: ${note}` : ""}`;
      }
      return "Advance changed";
    }
    case "revenue_overrides": {
      if (row.action === "override_superseded") return null;
      if (row.action === "override_set") {
        const value = rupeesOrNull(row.new.adjusted_value);
        const note = textOrNull(row.new.note);
        return lead(
          `adjusted to ${value === null ? "a new figure" : formatRupees(value)}${note ? `: ${note}` : ""}`,
        );
      }
      if (row.action === "override_cleared") {
        const note = textOrNull(row.new.superseded_note);
        return lead(`back to calculated${note ? `: ${note}` : ""}`);
      }
      return null;
    }
    default:
      return null;
  }
}

/** The rows as the history's lines, the ones it leaves out dropped, in the read's order. */
export function historyEntries(
  rows: readonly HistoryRow[],
  options: { oneTime: boolean },
): HistoryEntry[] {
  return rows.flatMap((row) => {
    const what = historyWords(row, options);
    if (what === null) return [];
    return [
      {
        id: row.id,
        when: formatDateTime(row.at, "d MMM yyyy"),
        who: row.actorName ?? "MaxOff",
        what,
      },
    ];
  });
}
