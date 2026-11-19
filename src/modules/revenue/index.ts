/**
 * modules/revenue: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * Business money (DATA-MODEL §7, WORKFLOWS §6, ADR-0007): **Owner only**. The money tables, views
 * and functions are named nowhere else in `src/` (lint), and nothing read here is ever in an
 * Admin's or a Crew member's payload, a notification's text, search or Realtime (invariant 2).
 * A page starts a read from here only after it knows the viewer holds `finance.view`.
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment, task 2.8), because a barrel is not tree-shaken per route.
 * `BillingSection` and `BillingSkeleton` are server components (the section's sheets are client
 * code it loads on the first tap).
 */
export { BillingSection } from "./components/billing-section";
export { BillingSkeleton } from "./components/billing-skeleton";
export { readProjectBilling } from "./data/billing";
export type { BillingRecurrence, ProjectBilling } from "./domain/billing";
