/**
 * Suggested tasks' header line, by who is looking: the page and its loading screen say the same
 * thing, so the header does not change when the data arrives (4C review S7, ARCHITECTURE §14.1).
 */
export function requestsDescription(decides: boolean): string {
  return decides
    ? "Tasks the team suggested: make one a task, or decline it with a reason."
    : "Tasks you suggested, and what became of them.";
}
