/**
 * The Owner's Reports list, shared by the page and its loading screen (ARCHITECTURE §14.1: a
 * skeleton traces its own screen), so the two cannot drift apart: the reports themselves (their
 * descriptions wrap to two or three lines on a phone, and the skeleton wraps the same words), the
 * bordered list, and each row's height and padding around its label and description.
 */

/** The reports the Owner can open today (kickoff 3b decision 30: Month is the first; 6.5: End of day). */
export const OWNER_REPORTS = [
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
] as const;

export const REPORTS_LIST_CLASS =
  "border-border divide-border divide-y overflow-hidden rounded-lg border md:max-w-2xl";

export const REPORT_ROW_CLASS = "flex min-h-14 items-center gap-3 px-4 py-3";

/** The label's line over the description's own lines. */
export const REPORT_LINES_CLASS = "flex min-w-0 flex-1 flex-col gap-0.5";
