/**
 * The Owner's Reports list, shared by the page and its loading screen (ARCHITECTURE §14.1: a
 * skeleton traces its own screen), so the two cannot drift apart: the reports themselves (their
 * descriptions wrap to two or three lines on a phone, and the skeleton wraps the same words), the
 * bordered list, and each row's height and padding around its label and description.
 */

/**
 * The reports the Owner can open (kickoff 3b decision 30: Month is the first; 6.5: End of day;
 * v3.0: People, Stage durations and Client work).
 */
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
  {
    key: "people",
    label: "People",
    href: "/reports/people",
    description:
      "Each person's tasks by week, month or a range: completed, on time, revision loops, and the tasks that ran late.",
  },
  {
    key: "stages",
    label: "Stage durations",
    href: "/reports/stages",
    description:
      "How long each deliverable stage takes, by stage name across projects and per project.",
  },
  {
    key: "client-work",
    label: "Client work",
    href: "/reports/client-work",
    description: "Each client's deliverables: planned and done, on time, overdue and on hold.",
  },
] as const;

export const REPORTS_LIST_CLASS =
  "border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border";

export const REPORT_ROW_CLASS = "flex min-h-14 items-center gap-3 px-4 py-3";

/** The label's line over the description's own lines. */
export const REPORT_LINES_CLASS = "flex min-w-0 flex-1 flex-col gap-0.5";
