import type { ISODate } from "@/core/time";

import { progressLine, progressOf, shortDate } from "./items";
import { cycleMeter, type CycleMeter, type MeterItem } from "./progress";
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
   * "9/12 done · 1 closed", or "No deliverables in this cycle."; null for a finished
   * project (only working projects have a current cycle).
   */
  progress: string | null;
  /**
   * The current cycle's meter (6b.11 (5), the Projects tab's miniature), when the cycle's items
   * came with their stages and it has something to count; null otherwise.
   */
  meter: CycleMeter | null;
  finished: boolean;
  /**
   * PP-client-2: a working one-time project whose deliverables are all done (none open, none
   * waiting), so Complete would go through (WORKFLOWS §5 item 14): it reads "Ready to complete".
   * Never a repeating one: its next cycle comes on its own, and completing it is a choice.
   */
  readyToComplete: boolean;
};

/**
 * A working project's current cycle with its items' states (the data layer's `listCurrentCycles`:
 * open or in-progress projects, the period covering today, or a one-time cycle).
 */
export type CurrentCycleStates = Pick<Cycle, "id" | "projectId" | "label"> & {
  clientId: string;
  states: readonly ItemState[];
  /** The items with their dates and ticks (`listCurrentCycleMeters`), for the meter. */
  items?: readonly MeterItem[];
  /** Each item's planned date in `states`' order (`listCurrentCycles`), for a client's Due. */
  plannedDates?: readonly (string | null)[];
};

export function projectSummaries(
  projects: readonly Project[],
  current: readonly CurrentCycleStates[],
  today?: ISODate,
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
      meter: meterOf(cycle, today),
      finished,
      readyToComplete: !finished && readyToComplete(project.recurrence, cycle?.states ?? []),
    };
  });
  return summaries.sort(
    (a, b) => Number(a.finished) - Number(b.finished) || a.name.localeCompare(b.name),
  );
}

/**
 * Whether a working project reads "Ready to complete" (PP-client-2) from its cycle's deliverable
 * states: one-time only, at least one done and none open or waiting (`project_complete` refuses
 * while any is open or done, WORKFLOWS §5 item 14; a one-time project has the one cycle).
 */
export function readyToComplete(
  recurrence: Project["recurrence"],
  states: readonly ItemState[],
): boolean {
  if (recurrence !== "one_time") return false;
  const done = states.some((state) => state === "approved");
  return done && !states.some((state) => state === "open" || state === "done");
}

function meterOf(
  cycle: CurrentCycleStates | undefined,
  today: ISODate | undefined,
): CycleMeter | null {
  if (!cycle?.items || today === undefined) return null;
  const meter = cycleMeter(cycle.items, today);
  return meter.units > 0 ? meter : null;
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
    const sum = result.get(cycle.clientId) ?? { total: 0, done: 0, closed: 0 };
    result.set(cycle.clientId, {
      total: sum.total + progress.total,
      done: sum.done + progress.done,
      closed: sum.closed + progress.closed,
    });
  }
  return result;
}

/**
 * The Admin's Clients list's work column (N4, UX review 2026-10-21; never money, invariant 2):
 * "3 open · 9/12 done" across the client's running cycles, or null when it has none now.
 */
export function clientWorkLine(progress: ReturnType<typeof progressOf> | undefined): string | null {
  if (!progress || progress.total === 0) return null;
  const open = progress.total - progress.done - progress.closed;
  return `${open} open · ${progress.done}/${progress.total} done`;
}

/** "Deliverables 9/12 done" (amendment D3; 6b wording), or null when the client has none now. */
export function clientProgressLine(
  progress: ReturnType<typeof progressOf> | undefined,
): string | null {
  if (!progress || progress.total === 0) return null;
  return `Deliverables ${progress.done}/${progress.total} done`;
}

/** A client's open deliverables by date (PP-admin-10): how many are late, and the next one due. */
export type ClientDue = { late: number; next: ISODate | null };

/**
 * Each client's Due across its running cycles (PP-admin-10, the Clients list's column): the open
 * deliverables past their planned date (IST, as `isOverdue`), and the earliest planned date from
 * today on. A client with nothing open and dated is left out.
 */
export function dueByClient(
  current: readonly CurrentCycleStates[],
  today: ISODate,
): Map<string, ClientDue> {
  const due = new Map<string, ClientDue>();
  for (const cycle of current) {
    cycle.states.forEach((state, index) => {
      const planned = cycle.plannedDates?.[index] ?? null;
      if (state !== "open" || planned === null) return;
      const sum = due.get(cycle.clientId) ?? { late: 0, next: null };
      if (planned < today) sum.late += 1;
      else if (sum.next === null || planned < sum.next) sum.next = planned;
      due.set(cycle.clientId, sum);
    });
  }
  return due;
}
