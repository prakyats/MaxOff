/**
 * The task page's back control (§14.2 k, 6b.12 (2)): its parent is Tasks, and it is drilled into
 * from these screens as well; back returns to the one it came from (the calendar's view and day
 * with it, the address its entry holds) and names it. From anywhere else (a notification, a link
 * opened directly) it replaces with Tasks. Here rather than beside the page's reads (server
 * only) because the skeleton a tap draws (`TaskTapSkeleton`) shows the same header.
 */
export const TASK_BACK = {
  href: "/tasks",
  label: "Tasks",
  from: [
    { path: "/calendar", label: "Calendar" },
    { path: "/today", label: "Today" },
    { path: "/today/people", label: "Everyone today" },
    { path: "/my-day", label: "My Day" },
    { path: "/approvals", label: "Approvals" },
    { path: "/notifications", label: "Alerts" },
    { path: "/tasks/all", label: "All tasks" },
    { path: "/tasks/requests", label: "Suggested tasks" },
    { path: "/reports/end-of-day/*", label: "End of day" },
  ],
} as const;
