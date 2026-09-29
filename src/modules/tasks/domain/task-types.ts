import type { TaskTypeKind } from "./types";

/**
 * Settings → Task types (4C; PRODUCT §4.6, Kickoff 4 decisions 14, 15): the Owner's list. A type
 * is data (ADR-0002); its `kind` is the only behaviour code knows (DATA-MODEL §0) and is fixed
 * once the type exists, since open tasks were shaped by it. Archived, never deleted: a task keeps
 * an archived type, and only new tasks stop being offered it.
 */

/** One row of the editor: every column the Owner sees or changes. */
export type TaskTypeSetting = {
  id: string;
  name: string;
  kind: TaskTypeKind;
  showsOnCalendar: boolean;
  hasLocation: boolean;
  archivedAt: string | null;
  position: string;
};

export const TASK_TYPE_NAME_MAX = 80;

export const TASK_TYPE_KINDS: readonly TaskTypeKind[] = ["normal", "event", "custom"];

export const TASK_TYPE_KIND_LABELS: Record<TaskTypeKind, string> = {
  normal: "Normal",
  event: "Event",
  custom: "Custom",
};

/** What each kind asks for on a task, for the Add dialog. */
export const TASK_TYPE_KIND_LINES: Record<TaskTypeKind, string> = {
  normal: "A deadline and the work to do.",
  event: "A date, a start and end time and a purpose: a shoot, a meeting, a posting.",
  custom: "A deadline, shaped by the task fields you add for it.",
};

/**
 * The line under a type's name: its kind and, for an event, where it shows and what it asks
 * ("Event · on the calendar · asks for a location"). Only an event has the two switches: the
 * task form asks for a location inside the event's fields.
 */
export function taskTypeLine(
  type: Pick<TaskTypeSetting, "kind" | "showsOnCalendar" | "hasLocation">,
): string {
  const parts = [TASK_TYPE_KIND_LABELS[type.kind]];
  if (type.kind === "event") {
    parts.push(type.showsOnCalendar ? "on the calendar" : "not on the calendar");
    if (type.hasLocation) parts.push("asks for a location");
  }
  return parts.join(" · ");
}

/**
 * Whether archiving this type would leave nothing to create a task with: the last active type
 * stays (the create dialog always needs one).
 */
export function isLastActiveType(
  types: readonly Pick<TaskTypeSetting, "id" | "archivedAt">[],
  id: string,
): boolean {
  const active = types.filter((type) => type.archivedAt === null);
  return active.length === 1 && active[0]?.id === id;
}

/** Active types first in the Owner's order, then the archived ones by name. */
export function splitTaskTypes<T extends Pick<TaskTypeSetting, "archivedAt" | "position" | "name">>(
  types: readonly T[],
): { active: T[]; archived: T[] } {
  const active = types
    .filter((type) => type.archivedAt === null)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const archived = types
    .filter((type) => type.archivedAt !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { active, archived };
}
