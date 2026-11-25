import { formatRupees } from "@/core/lib/rupees";
import { formatIST, istDayStart } from "@/core/time";

/**
 * The Owner's **Today line** (v2.5 "Revenue every day", kickoff 9 R5): this IST month's Achieved
 * of its Potential at the end of Today, with what needs a look, its amounts **masked** ("₹ •••")
 * until the Owner taps the line. Pure, and **Owner only**: the read refuses anyone without
 * `finance.view` and Today asks for it only for the Owner (invariant 2).
 */

/** What `revenue_month_totals` answers, in the app's own names. */
export type MonthTotals = {
  /** The month's first day (IST). */
  month: string;
  potential: number;
  achieved: number;
  remaining: number;
  /** Deliverables added on top of a priced cycle and still without a price. */
  notPriced: number;
  /** Cycles and one-time projects of the month without an amount. */
  noAmount: number;
};

/** How a masked amount reads: the rupee sign and three dots, never a digit. */
export const MASKED_AMOUNT = "₹ •••";

type Json = Record<string, unknown>;

function figure(value: unknown): number {
  const amount = Number(value ?? 0);
  // The message never repeats the value: an error report carries no money (ARCHITECTURE §18.2).
  if (!Number.isFinite(amount))
    throw new Error("The month's totals hold an amount that is not one.");
  return amount;
}

const count = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** The read's JSON as the line's own shape. */
export function toMonthTotals(value: unknown): MonthTotals {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The month's totals are missing.");
  }
  const read = value as Json;
  if (typeof read.month !== "string") throw new Error("The month's totals have no month.");
  return {
    month: read.month,
    potential: figure(read.potential),
    achieved: figure(read.achieved),
    remaining: figure(read.remaining),
    notPriced: count(read.not_priced),
    noAmount: count(read.no_amount),
  };
}

/**
 * "November · ₹ ••• achieved of ₹ ••• · 2 not priced · 1 with no amount" (masked), or the same
 * with the real figures once tapped. The counts are left out at zero.
 */
export function todayRevenueLine(totals: MonthTotals, { masked }: { masked: boolean }): string {
  const money = (value: number) => (masked ? MASKED_AMOUNT : formatRupees(value));
  const month = formatIST(istDayStart(`${totals.month.slice(0, 7)}-01`), "MMMM");
  return [
    `${month} · ${money(totals.achieved)} achieved of ${money(totals.potential)}`,
    totals.notPriced > 0 ? `${totals.notPriced} not priced` : null,
    totals.noAmount > 0 ? `${totals.noAmount} with no amount` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}
