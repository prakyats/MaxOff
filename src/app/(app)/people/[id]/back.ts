/**
 * People is the parent; a person is opened from these screens too, and back returns to the one it
 * came from and names it (§14.2 k, 6b.12).
 */
export const PERSON_BACK = {
  href: "/people",
  label: "People",
  from: [
    { path: "/today/people", label: "Everyone today" },
    { path: "/today", label: "Today" },
    { path: "/approvals", label: "Approvals" },
    { path: "/reports/month", label: "Month" },
    { path: "/reports/end-of-day/*", label: "End of day" },
  ],
};
