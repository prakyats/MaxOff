/**
 * The task page's views, apart from the page's other rules (`page.ts` re-exports them), so a
 * small client part (`TaskTapSkeleton`, #143) reads the view of an address without the rest.
 */
export type TaskView = "work" | "chat" | "details";

/**
 * The views. Activity left them in the v1.8 consistency sweep (owner 2026-10-21): the task's
 * history is the header's History sheet, as on every detail page; an old `?tab=activity` link
 * lands on Work with that sheet open (`HISTORY_ARRIVAL`).
 */
export const TASK_VIEWS: readonly TaskView[] = ["work", "chat", "details"];

/** The view a `?tab=` value asks for; anything else is Work, where a task lands (decision 32). */
export function parseTaskView(value: string | null | undefined): TaskView {
  return TASK_VIEWS.find((view) => view === value) ?? "work";
}
