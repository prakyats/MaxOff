import type { Engagement, TaskState } from "./types";

/**
 * The full task list's filters (4.5; Kickoff 4 decision 17: person, client, type, state, overdue;
 * decision 18: engagement). View controls on `/tasks/all` (ARCHITECTURE §14.2 d). Free of any
 * import but types, so the list's client component carries no date library for them; the server
 * works out each row's facts (who is on it now, overdue at render) beforehand.
 */

/** A row as the filters read it. */
export type FilterableTask = {
  state: TaskState;
  clientId: string | null;
  taskTypeId: string;
  /** The people on the task now (active assignees). */
  activeIds: readonly string[];
  /** Their engagements (ADR-0013), one per active assignee. */
  engagements: readonly Engagement[];
  /** Past its deadline and not completed or cancelled, at render. */
  overdue: boolean;
};

const FINAL: readonly TaskState[] = ["completed", "cancelled"];
const REVIEW: readonly TaskState[] = ["submitted", "admin_approved"];

export const STATE_FILTERS = [
  "open",
  "todo",
  "in_progress",
  "review",
  "changes_requested",
  "completed",
  "cancelled",
  "all",
] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];

export const STATE_FILTER_LABELS: Record<StateFilter, string> = {
  open: "Open",
  todo: "To do",
  in_progress: "In progress",
  review: "With the reviewers",
  changes_requested: "Changes requested",
  completed: "Completed",
  cancelled: "Cancelled",
  all: "Any state",
};

/** "all" is every other filter's widest option and its default. */
export const ALL = "all";
export const NO_CLIENT = "none";

export function matchesState(task: Pick<FilterableTask, "state">, value: string): boolean {
  switch (value) {
    case "all":
      return true;
    case "open":
      return !FINAL.includes(task.state);
    case "review":
      return REVIEW.includes(task.state);
    default:
      return task.state === value;
  }
}

/** A person filter: tasks the person is on now. */
export function matchesPerson(task: Pick<FilterableTask, "activeIds">, value: string): boolean {
  return value === ALL || task.activeIds.includes(value);
}

export function matchesClient(task: Pick<FilterableTask, "clientId">, value: string): boolean {
  if (value === ALL) return true;
  if (value === NO_CLIENT) return task.clientId === null;
  return task.clientId === value;
}

export function matchesType(task: Pick<FilterableTask, "taskTypeId">, value: string): boolean {
  return value === ALL || task.taskTypeId === value;
}

export function matchesOverdue(task: Pick<FilterableTask, "overdue">, value: string): boolean {
  return value !== "overdue" || task.overdue;
}

/** Decision 18: a task with a freelancer on it, or with an employee on it. */
export function matchesEngagement(
  task: Pick<FilterableTask, "engagements">,
  value: string,
): boolean {
  return value === ALL || task.engagements.includes(value as Engagement);
}
