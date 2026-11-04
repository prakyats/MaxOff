import type { MemberRole, TaskState } from "./types";

/**
 * On hold, for tasks (v1.9 W7; WORKFLOWS §3.1a, ADR-0016). A hold is not a state: the task keeps
 * the state it resumes to, and `heldAt` / `holdReason` say it is paused. Pure, so the rules the
 * screens show are unit-tested; `task_hold` and `task_resume` decide again on every tap.
 */

/** The longest reason a hold takes (the database's check). */
export const HOLD_REASON_MAX = 1000;

/** Only a task still with its people is put on hold (handed-in work waits for its reviewers). */
const HOLDABLE_STATES: readonly TaskState[] = ["todo", "in_progress", "changes_requested"];

export function isOnHold(task: { heldAt?: string | null }): boolean {
  return Boolean(task.heldAt);
}

/** Whether "Put on hold…" applies to the task now: with its people and not held already. */
export function canHold(task: { state: TaskState; heldAt?: string | null }): boolean {
  return !isOnHold(task) && HOLDABLE_STATES.includes(task.state);
}

/**
 * Who holds and resumes a task (owner 2026-10-23): its creator, while they may create tasks (the
 * Owner or an Admin), and the Owner always. An approving Admin who did not create it, Crew, a
 * coordinator: never.
 */
export function mayHoldOrResume(
  viewer: { id: string; role: MemberRole; canCreateTasks: boolean },
  task: { createdBy: string },
): boolean {
  return viewer.role === "owner" || (task.createdBy === viewer.id && viewer.canCreateTasks);
}

/**
 * The resume sheet asks for a new deadline only when the old one has passed (owner 2026-10-23);
 * otherwise the task simply resumes.
 */
export function resumeNeedsDeadline(
  task: { dueAt: string; heldAt?: string | null },
  now: Date,
): boolean {
  return isOnHold(task) && Date.parse(task.dueAt) <= now.getTime();
}

/** Why a resume's new deadline is refused, or null when it may be sent. */
export function resumeDeadlineProblem(
  task: { dueAt: string; heldAt?: string | null },
  newDueAt: string | null,
  now: Date,
): string | null {
  if (newDueAt === null) {
    return resumeNeedsDeadline(task, now) ? "The deadline has passed: set a new one." : null;
  }
  const at = Date.parse(newDueAt);
  if (Number.isNaN(at)) return "Choose a new deadline.";
  return at <= now.getTime() ? "Choose a new deadline in the future." : null;
}

/** Why a hold's reason is refused, or null (required, at most HOLD_REASON_MAX characters). */
export function holdReasonProblem(reason: string): string | null {
  const text = reason.trim();
  if (!text) return "Say why it is on hold.";
  return text.length > HOLD_REASON_MAX
    ? `Keep the reason under ${HOLD_REASON_MAX} characters.`
    : null;
}

/**
 * A to-do or overdue list without its held tasks, and the held ones apart for the "On hold · n"
 * line that opens them (W8). Order is kept.
 */
export function splitOnHold<T extends { heldAt?: string | null }>(
  rows: readonly T[],
): { active: T[]; onHold: T[] } {
  const active: T[] = [];
  const onHold: T[] = [];
  for (const row of rows) (isOnHold(row) ? onHold : active).push(row);
  return { active, onHold };
}

/** "On hold · 2", or null when nothing is held (the line is not drawn). */
export function onHoldLine(count: number): string | null {
  return count > 0 ? `On hold · ${count}` : null;
}

/** What the task's ⋯ offers about a hold (W8): "Put on hold…" or "Resume…", for whoever may. */
export function holdActions(
  viewer: { id: string; role: MemberRole; canCreateTasks: boolean },
  task: { createdBy: string; state: TaskState; heldAt?: string | null },
): { hold: boolean; resume: boolean } {
  const may = mayHoldOrResume(viewer, task);
  return { hold: may && canHold(task), resume: may && isOnHold(task) };
}

/**
 * The task page's hold line (the sample §1): "On hold since 24 Oct" and who put it on hold with
 * the reason, "Prishit: "Client hasn't sent the footage"". `since` is the IST day, worded by the
 * caller (`formatIST(heldAt, "d MMM")`).
 */
export function holdLine(input: { since: string; by: string | null; reason: string | null }): {
  title: string;
  reason: string | null;
} {
  const reason = input.reason?.trim() ? `"${input.reason.trim()}"` : null;
  return {
    title: `On hold since ${input.since}`,
    reason: reason && input.by ? `${input.by}: ${reason}` : reason,
  };
}

/**
 * Why the work controls wait on a held task, in plain words (the database refuses Start, Done and
 * the stage ticks until the resume: W7's open question 1 on #89).
 */
export const HELD_WORK_NOTE = "Start, Done and the stage ticks wait until the task is resumed.";
