import { addISTDays, formatIST, istDayStart } from "@/core/time";

/**
 * Expense claims (PRODUCT §4.18, WORKFLOWS §2a, task 3b.3): the states, the claim window, the
 * receipt rule and how an amount reads. Zod-free, so client components use it without bundling
 * the schemas (task 2.8). The database is the rule; these mirror it for the form and the screens.
 */

export const CLAIM_STATES = ["submitted", "approved", "rejected", "withdrawn", "paid"] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export function isClaimState(value: unknown): value is ClaimState {
  return typeof value === "string" && (CLAIM_STATES as readonly string[]).includes(value);
}

/** A claim as its claimant and the Owner read it. */
export type ExpenseClaim = {
  id: string;
  memberId: string;
  expenseDate: string;
  amount: number;
  categoryName: string;
  note: string;
  receiptFileId: string | null;
  state: ClaimState;
  decisionReason: string | null;
  paidOn: string | null;
  createdAt: string;
};

/** An expense category the form offers (list_items `expense_category`, the Owner's list). */
export type ExpenseCategory = { id: string; name: string };

/** What the claim form needs: the active categories and the receipt amount. */
export type ClaimSetup = { categories: ExpenseCategory[]; receiptAbove: number };

/** At most this many characters in a claim's note (the database's check). */
export const CLAIM_NOTE_MAX_LENGTH = 500;
/** `numeric(12,2)`: anything at or above this cannot be stored. */
export const CLAIM_AMOUNT_LIMIT = 10_000_000_000;
/** The last day of a month on which last month's expenses may still be claimed (decision 24). */
export const CLAIM_GRACE_DAYS = 5;

/**
 * The dates a claim may carry on `today` (IST), both inclusive: this month, or last month too
 * through the 5th; never the future. The mirror of `app.expense_window_start()`.
 */
export function claimWindow(today: string): { from: string; to: string } {
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  if (day > CLAIM_GRACE_DAYS) return { from: `${month}-01`, to: today };
  const lastOfPrevious = addISTDays(`${month}-01`, -1);
  return { from: `${lastOfPrevious.slice(0, 7)}-01`, to: today };
}

/** Whether a date may be claimed on `today`. */
export function inClaimWindow(date: string, today: string): boolean {
  const { from, to } = claimWindow(today);
  return date >= from && date <= to;
}

/** A receipt is needed **above** the Owner's amount (₹500 exactly needs none). */
export function receiptRequired(amount: number, receiptAbove: number): boolean {
  return amount > receiptAbove;
}

/**
 * The typed amount as rupees, or null when it is not one: digits with an optional comma
 * grouping, at most two decimals, above zero and storable. "1,200.50" → 1200.5.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!(value > 0) || value >= CLAIM_AMOUNT_LIMIT) return null;
  return value;
}

const RUPEES = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const RUPEES_PAISE = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "₹1,200", "₹42.50": whole rupees stay whole, paise always show two digits. */
export function formatRupees(amount: number): string {
  return Number.isInteger(amount) ? RUPEES.format(amount) : RUPEES_PAISE.format(amount);
}

/** "Sat, 27 Sep". */
export function claimDate(date: string): string {
  return formatIST(istDayStart(date), "EEE, d MMM");
}

/**
 * The Owner's Today compact row's first meta line (owner 2026-10-09): "₹385 · Food · Thu 8 Oct",
 * then "No receipt" when there is none. The category is the claim's own words; the rest is short.
 */
export function claimDetail(
  claim: Pick<ExpenseClaim, "amount" | "categoryName" | "expenseDate" | "receiptFileId">,
): string {
  const parts = [
    formatRupees(claim.amount),
    claim.categoryName,
    formatIST(istDayStart(claim.expenseDate), "EEE d MMM"),
  ];
  if (!claim.receiptFileId) parts.push("No receipt");
  return parts.join(" · ");
}

/** "3 Oct 2026". */
function longDate(date: string): string {
  return formatIST(istDayStart(date), "d MMM yyyy");
}

/**
 * How a claim stands, in the claimant's words, and the status key its dot takes (a DATA-MODEL §0
 * value with the right tone: a paid claim reads as `completed`, the same success tone).
 */
export function claimOutcome(claim: Pick<ExpenseClaim, "state" | "decisionReason" | "paidOn">): {
  status: Exclude<ClaimState, "paid"> | "completed";
  text: string;
} {
  switch (claim.state) {
    case "submitted":
      return { status: "submitted", text: "Waiting for the Owner" };
    case "approved":
      return { status: "approved", text: "Approved · not paid yet" };
    case "paid":
      return {
        status: "completed",
        text: claim.paidOn ? `Paid on ${longDate(claim.paidOn)}` : "Paid",
      };
    case "rejected":
      return { status: "rejected", text: "Rejected" };
    case "withdrawn":
      return { status: "withdrawn", text: "Withdrawn" };
  }
}

/** "Travel · Sat, 27 Sep". */
export function claimTitle(claim: Pick<ExpenseClaim, "categoryName" | "expenseDate">): string {
  return `${claim.categoryName} · ${claimDate(claim.expenseDate)}`;
}

/** What the claimant may do with a claim: withdraw while it waits (WORKFLOWS §2a). */
export function claimActions(claim: Pick<ExpenseClaim, "state">): { withdraw: boolean } {
  return { withdraw: claim.state === "submitted" };
}

/** The approved, not yet paid part of a list of claims: the month summary's expense line. */
export function unpaidTotal(claims: readonly Pick<ExpenseClaim, "state" | "amount">[]): {
  total: number;
  count: number;
} {
  let total = 0;
  let count = 0;
  for (const claim of claims) {
    if (claim.state !== "approved") continue;
    // Paise as integers, so the sum of 0.1 + 0.2 is 0.30, not 0.30000000000000004.
    total += Math.round(claim.amount * 100);
    count += 1;
  }
  return { total: total / 100, count };
}

/** "3 claims", "1 claim". */
export function claimsLabel(count: number): string {
  return `${count} ${count === 1 ? "claim" : "claims"}`;
}
