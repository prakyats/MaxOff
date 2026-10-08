import type { ISODate } from "@/core/time";

import { currentCycle, progressLine, progressOf, shortDate } from "./items";
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
  /** "9/12 done · 8/12 approved · 1 closed", or "No items in this cycle.". */
  progress: string;
  finished: boolean;
};

export function projectSummaries(
  projects: readonly Project[],
  cycles: readonly Cycle[],
  items: readonly { cycleId: string; state: ItemState }[],
  today: ISODate,
): ProjectSummary[] {
  const byProject = new Map<string, Cycle[]>();
  for (const cycle of cycles) {
    byProject.set(cycle.projectId, [...(byProject.get(cycle.projectId) ?? []), cycle]);
  }
  const summaries = projects.map((project) => {
    const cycle = currentCycle(byProject.get(project.id) ?? [], today);
    const states = cycle ? items.filter((item) => item.cycleId === cycle.id) : [];
    const parts = [RECURRENCE_LABELS[project.recurrence]];
    if (project.recurrence === "one_time" && project.deliveryDate) {
      parts.push(`delivery ${shortDate(project.deliveryDate)}`);
    } else if (cycle?.label) {
      parts.push(cycle.label);
    } else if (project.recurrence !== "one_time") {
      parts.push("no cycle yet");
    }
    return {
      id: project.id,
      name: project.name,
      state: project.state,
      stateLabel: PROJECT_STATE_LABELS[project.state],
      meta: parts.join(" · "),
      progress: progressLine(progressOf(states)),
      finished: project.state === "completed" || project.state === "cancelled",
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
  projects: readonly Project[],
  cycles: readonly Cycle[],
  items: readonly { cycleId: string; state: ItemState }[],
  today: ISODate,
): Map<string, ReturnType<typeof progressOf>> {
  const byProject = new Map<string, Cycle[]>();
  for (const cycle of cycles) {
    byProject.set(cycle.projectId, [...(byProject.get(cycle.projectId) ?? []), cycle]);
  }
  const result = new Map<string, ReturnType<typeof progressOf>>();
  for (const project of projects) {
    if (project.state !== "open" && project.state !== "in_progress") continue;
    const cycle = currentCycle(byProject.get(project.id) ?? [], today);
    if (!cycle) continue;
    const progress = progressOf(items.filter((item) => item.cycleId === cycle.id));
    const sum = result.get(project.clientId) ?? { total: 0, done: 0, approved: 0, closed: 0 };
    result.set(project.clientId, {
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
