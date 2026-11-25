/**
 * modules/revenue: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * Business money (DATA-MODEL §7, WORKFLOWS §6, ADR-0007): **Owner only**. The money tables, views
 * and functions are named nowhere else in `src/` (lint: `MONEY_NAMES` in `eslint.config.mjs`
 * lists each table, view and function; only `core/db`'s generated types are exempt), and nothing read here is ever in an
 * Admin's or a Crew member's payload, a notification's text, search or Realtime (invariant 2).
 * A page starts a read from here only after it knows the viewer holds `finance.view`.
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment, task 2.8), because a barrel is not tree-shaken per route.
 * `BillingSection` and `BillingSkeleton` are server components (the section's sheets are client
 * code it loads on the first tap), and so are the Revenue page's `RevenueReport` and
 * `RevenueSkeleton` (its month and category controls are `ViewLink`s), and the Owner's Today
 * line `TodayRevenueLine` (v2.5 review: it reads nothing; its tap is client code loaded after the
 * page, which asks `GET /api/revenue/month-totals` → `readTodayRevenue`).
 */
export { BillingSection } from "./components/billing-section";
export { BillingSkeleton } from "./components/billing-skeleton";
export { readProjectBilling } from "./data/billing";
export { oneTimeStatusExpected } from "./domain/billing";
export type { BillingRecurrence, ProjectBilling } from "./domain/billing";
export { RevenueReport } from "./components/revenue-report";
export { RevenueSkeleton } from "./components/revenue-skeleton";
export { readRevenueMonth } from "./data/revenue";
export { parseCategory, parseMonth } from "./domain/revenue";
export { TodayRevenueLine } from "./components/today-revenue-line";
export {
  readBillingHistoryPage,
  readTodayRevenue,
  type BillingHistoryPage,
} from "./actions/background";
