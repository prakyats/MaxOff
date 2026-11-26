/**
 * The Owner's Reports list, shared by the page and its loading screen (ARCHITECTURE §14.1: a
 * skeleton traces its own screen), so the two cannot drift apart: the reports themselves (their
 * descriptions wrap to two or three lines on a phone, and the skeleton wraps the same words), the
 * bordered list, and each row's height and padding around its label and description.
 */

import { can, type MemberRole, type PermissionKey } from "@/core/permissions";

/** One row of the list; `permission` is asked on top of the list's own (the Owner's branch). */
type OwnerReport = {
  key: string;
  label: string;
  href: string;
  description: string;
  permission?: PermissionKey;
};

/** The reports the Owner can open today (kickoff 3b decision 30: Month is the first; 6.5: End of day). */
export const OWNER_REPORTS: readonly OwnerReport[] = Object.freeze([
  // 9.2 (v2.1): money, so only with `finance.view` (the Owner alone holds it). First: it is the
  // month's headline.
  {
    key: "revenue",
    label: "Revenue",
    href: "/reports/revenue",
    description: "Client work in rupees: Potential, Achieved and Remaining, client by client.",
    permission: "finance.view",
  },
  {
    key: "month",
    label: "Month",
    href: "/reports/month",
    description:
      "Everyone's month: days worked, additional leave, comp leave, overtime and expenses to pay.",
  },
  {
    key: "end-of-day",
    label: "End of day",
    href: "/reports/end-of-day",
    description:
      "Each day's attendance, decisions, tasks, approvals and tomorrow's events: today live, every day before saved.",
  },
]);

/**
 * Whether a viewer's list shows a report: the page and its loading screen both ask, so a row
 * that needs its own permission (Revenue) is in neither for anyone without it.
 */
export function showsReport(role: MemberRole, report: OwnerReport): boolean {
  return report.permission === undefined || can(role, report.permission);
}

export const REPORTS_LIST_CLASS =
  "border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border";

export const REPORT_ROW_CLASS = "flex min-h-14 items-center gap-3 px-4 py-3";

/** The label's line over the description's own lines. */
export const REPORT_LINES_CLASS = "flex min-w-0 flex-1 flex-col gap-0.5";
