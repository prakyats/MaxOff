/**
 * modules/expenses: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * A member's own expense claims (PRODUCT §4.18, WORKFLOWS §2a, task 3b.3; ADR-0007 amendment
 * 2026-09-27): the member's list and the claim form's setup, the Owner's Approvals group and a
 * person's month of claims, and the receipt amount of Settings → Expenses. Sealed like
 * `modules/revenue`: the table is named nowhere else in `src/` (lint), and nothing here is ever
 * in an Admin's payload for someone else, a notification's text, search or Realtime.
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment, task 2.8), because a barrel is not tree-shaken per route.
 */
export {
  countPendingClaims,
  getClaimSetup,
  getReceiptAbove,
  listApprovedInMonth,
  listMemberMonthClaims,
  listOwnClaims,
  listPendingClaims,
} from "./data/claims";
export type { ClaimSetup, ExpenseClaim } from "./domain/claims";
export { claimsLabel, formatRupees, unpaidTotal } from "./domain/claims";
