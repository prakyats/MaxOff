import { progressLine, progressOf, shortDate } from "./items";
import {
  PROJECT_STATE_LABELS,
  RECURRENCE_LABELS,
  type Cycle,
  type ItemState,
  type Project,
} from "./types";

/**
 * A client's Projects tab (7.3; PRODUCT §4.5, kickoff 7 decisions 18, 26): each project with its
 * repeat, its state and the current cycle's progress line; working projects first, finished ones
 * after. Pure, unit-tested.
 */

export type ProjectSummary = {
  id: string;
  name: string;
  state: Project["state"];
  stateLabel: string;
  /** "Monthly · October 2026", "One-time · delivery 20 Oct". */
  meta: string;
  /**
   * "9/12 done · 8/12 approved · 1 closed", or "No items in this cycle."; null for a finished
   * project (only working projects have a current cycle).
   */
  progress: string | null;
  finished: boolean;
};

/**
 * A working project's current cycle with its items' states (the data layer's `listCurrentCycles`:
 * open or in-progress projects, the period covering today, or a one-time cycle).
 */
export type CurrentCycleStates = Pick<Cycle, "id" | "projectId" | "label"> & {
  clientId: string;
  states: readonly ItemState[];
};

export function projectSummaries(
  projects: readonly Project[],
  current: readonly CurrentCycleStates[],
): ProjectSummary[] {
  const cycleOf = new Map(current.map((cycle) => [cycle.projectId, cycle]));
  const summaries = projects.map((project) => {
    const finished = project.state === "completed" || project.state === "cancelled";
    const cycle = finished ? undefined : cycleOf.get(project.id);
    const parts = [RECURRENCE_LABELS[project.recurrence]];
    if (project.recurrence === "one_time" && project.deliveryDate) {
      parts.push(`delivery ${shortDate(project.deliveryDate)}`);
    } else if (cycle?.label) {
      parts.push(cycle.label);
    } else if (project.recurrence !== "one_time" && !finished) {
      parts.push("no current cycle");
    }
    return {
      id: project.id,
      name: project.name,
      state: project.state,
      stateLabel: PROJECT_STATE_LABELS[project.state],
      meta: parts.join(" · "),
      progress: finished
        ? null
        : progressLine(progressOf((cycle?.states ?? []).map((state) => ({ state })))),
      finished,
    };
  });
  return summaries.sort(
    (a, b) => Number(a.finished) - Number(b.finished) || a.name.localeCompare(b.name),
  );
}

/**
 * Each client's current cycles, added up (the Admin's Today "My clients", kickoff 6 decision 9 /
 * kickoff 7: "cycle progress joins its counts"): the working projects' running cycles.
 */
export function progressByClient(
  current: readonly CurrentCycleStates[],
): Map<string, ReturnType<typeof progressOf>> {
  const result = new Map<string, ReturnType<typeof progressOf>>();
  for (const cycle of current) {
    const progress = progressOf(cycle.states.map((state) => ({ state })));
    const sum = result.get(cycle.clientId) ?? { total: 0, done: 0, approved: 0, closed: 0 };
    result.set(cycle.clientId, {
      total: sum.total + progress.total,
      done: sum.done + progress.done,
      approved: sum.approved + progress.approved,
      closed: sum.closed + progress.closed,
    });
  }
  return result;
}

/** "Items 9/12 done · 8/12 approved", or null when the client has no current items. */
export function clientProgressLine(
  progress: ReturnType<typeof progressOf> | undefined,
): string | null {
  if (!progress || progress.total === 0) return null;
  return `Items ${progress.done}/${progress.total} done · ${progress.approved}/${progress.total} approved`;
}
