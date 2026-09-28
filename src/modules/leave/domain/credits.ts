import { formatIST, istDayStart } from "@/core/time";

/**
 * Comp leave credits (PRODUCT §4.3a, 3b.2): what the Owner granted, what is left of it, and how
 * the app says so. The status is **derived**, exactly as the database derives it (DATA-MODEL §3
 * `comp_leave_credits`): nothing stores "expired". Pure, so it is unit-tested.
 */

export type CompCredit = {
  id: string;
  days: number;
  usedDays: number;
  reservedDays: number;
  grantedOn: string;
  expiresOn: string;
  /** The Owner's optional note, shown to the member. */
  note: string | null;
  /** The extra-work note it answered, when it did (a standalone grant has none). */
  noteId: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

export type CompCreditStatus = "available" | "reserved" | "used" | "expired" | "revoked";

/** The free days on one credit today: nothing once revoked or past its month. */
export function creditFree(credit: CompCredit, today: string): number {
  if (credit.revokedAt || credit.expiresOn < today) return 0;
  return credit.days - credit.usedDays - credit.reservedDays;
}

/**
 * revoked → used (all of it taken) → expired (its month ended; whatever was left is lost) →
 * reserved (a request waits on the rest) → available.
 */
export function creditStatus(credit: CompCredit, today: string): CompCreditStatus {
  if (credit.revokedAt) return "revoked";
  if (credit.usedDays >= credit.days) return "used";
  if (credit.expiresOn < today) return "expired";
  if (credit.reservedDays > 0 && creditFree(credit, today) <= 0) return "reserved";
  return "available";
}

export const CREDIT_STATUS_LABELS: Record<CompCreditStatus, string> = {
  available: "Available",
  reserved: "Waiting on a request",
  used: "Used",
  expired: "Expired",
  revoked: "Revoked",
};

/** "½", "1", "1½", "2": days of comp leave in the words the screens use. */
export function formatDays(days: number): string {
  const whole = Math.floor(days);
  const half = days - whole >= 0.5;
  if (whole === 0) return half ? "½" : "0";
  return half ? `${whole}½` : String(whole);
}

/** "½ day", "1 day", "1½ days". */
export function daysLabel(days: number): string {
  return `${formatDays(days)} ${days === 1 || days === 0.5 ? "day" : "days"}`;
}

/** "use by 30 Sep". */
export function expiryLabel(expiresOn: string): string {
  return `use by ${formatIST(istDayStart(expiresOn), "d MMM")}`;
}

/** The balance the leave form and the cards show (`comp_leave_balance()`). */
export type CompBalance = { availableDays: number; useBy: string | null };

/**
 * "1½ days of comp leave · use by 30 Sep", or "No comp leave available": the one line on top of
 * the member's Extra work tab and the Owner's view of a person.
 */
export function balanceLine(balance: CompBalance): string {
  if (balance.availableDays <= 0 || !balance.useBy) return "No comp leave available";
  return `${daysLabel(balance.availableDays)} of comp leave · ${expiryLabel(balance.useBy)}`;
}

/** One credit as a row: "1 day · granted 12 Sep · Available (use by 30 Sep)". */
export function describeCredit(
  credit: CompCredit,
  today: string,
): { title: string; detail: string; status: CompCreditStatus } {
  const status = creditStatus(credit, today);
  const granted = `granted ${formatIST(istDayStart(credit.grantedOn), "d MMM")}`;
  const free = creditFree(credit, today);
  const parts: string[] = [];
  if (status === "available" && free < credit.days) parts.push(`${formatDays(free)} left`);
  if (status === "available" || status === "reserved") parts.push(expiryLabel(credit.expiresOn));
  if (status === "expired" && credit.usedDays > 0) {
    parts.push(`${formatDays(credit.usedDays)} used, the rest expired`);
  }
  return {
    title: `${daysLabel(credit.days)} · ${granted}`,
    detail: parts.join(" · "),
    status,
  };
}

/** The comp leave kinds the leave form may offer, given the balance (decision 16). */
export type CompLeaveKind = "comp_full" | "comp_half";

export function compKindsAvailable(balance: CompBalance): CompLeaveKind[] {
  const kinds: CompLeaveKind[] = [];
  if (balance.availableDays >= 1) kinds.push("comp_full");
  if (balance.availableDays >= 0.5) kinds.push("comp_half");
  return kinds;
}

export const COMP_KIND_LABELS: Record<CompLeaveKind, string> = {
  comp_full: "Comp leave (1 day)",
  comp_half: "Comp leave, half day (½)",
};
