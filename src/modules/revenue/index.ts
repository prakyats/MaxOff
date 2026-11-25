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
// The month close (v3.5 U3): the one read and its shape, for the close screen (U4) and a closed month
// on the Revenue page (U5). The close and the correction are this module's actions, reached only
// through the close screen's own client components (U4). `MonthCloseScreen` and
// `MonthCloseSkeleton` are server components; `readMonthSnapshots` is the Revenue page's light read
// for its month header's "Close month" / "Closed 3 Oct · v1" and a closed month's figures (U5);
// `readClosedMonths` is the project page's, for the money sheets' "September is closed." line (U5).
export { MonthCloseScreen } from "./components/month-close-screen";
export { MonthCloseSkeleton } from "./components/month-close-skeleton";
export {
  readClosedMonths,
  readMonthClose,
  readMonthReminder,
  readMonthSnapshots,
} from "./data/month-close";
export { closeHref, parseCloseMonth, revenueMonthHref } from "./domain/month-close-view";
// The reminder (v3.5 U6): the Reports line's words; `readMonthReminder` above is its read.
export { monthReminderAction, monthReminderLine } from "./domain/month-reminder";
export type { MonthReminder } from "./domain/month-reminder";
export { CORRECTION_NOTE_MAX_LENGTH, CORRECTION_NOTE_MIN_LENGTH } from "./domain/month-close";
export type {
  ChangedSinceClose,
  LineChange,
  MonthCloseRead,
  SnapshotData,
  SnapshotVersion,
  TotalChange,
  WaitingList,
} from "./domain/month-close";
export { TodayRevenueLine } from "./components/today-revenue-line";
export {
  readBillingHistoryPage,
  readTodayRevenue,
  type BillingHistoryPage,
} from "./actions/background";
