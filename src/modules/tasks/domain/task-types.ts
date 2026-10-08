import type { ReminderRule } from "@/core/lib/reminder-rules";

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
  /** Its tasks' default reminders (5.3); `[]` = the organisation's. */
  defaultReminders: ReminderRule[];
  /** Its colour on the calendar (Kickoff 6 decision 25), always one of the palette. */
  color: TaskTypeColor;
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

/**
 * The curated colours a type takes on the calendar (Kickoff 6 decision 25): no red (overdue and
 * commit actions keep it, ARCHITECTURE §14.1), no green (the holiday strip), no amber (the due
 * count) and no grey (leave and others' busy time). The database refuses anything else
 * (`task_types_color_palette`); stored lower-case.
 */
export const TASK_TYPE_COLORS = [
  { value: "#2563eb", label: "Blue" },
  { value: "#4f46e5", label: "Indigo" },
  { value: "#7c3aed", label: "Violet" },
  { value: "#9333ea", label: "Purple" },
  { value: "#c026d3", label: "Magenta" },
  { value: "#0d9488", label: "Teal" },
  { value: "#0891b2", label: "Cyan" },
  { value: "#0284c7", label: "Sky" },
] as const;

export type TaskTypeColor = (typeof TASK_TYPE_COLORS)[number]["value"];

/** A type with no colour (or one from before the palette) is drawn in this one. */
export const DEFAULT_TASK_TYPE_COLOR: TaskTypeColor = "#2563eb";

/** The colour a type is drawn in: its own when it is in the palette, else the default. */
export function taskTypeColor(color: string | null | undefined): TaskTypeColor {
  const value = color?.toLowerCase();
  return (
    TASK_TYPE_COLORS.find((option) => option.value === value)?.value ?? DEFAULT_TASK_TYPE_COLOR
  );
}

/** "Blue", for the Settings row and its picker. */
export function taskTypeColorLabel(color: string | null | undefined): string {
  const value = taskTypeColor(color);
  return TASK_TYPE_COLORS.find((option) => option.value === value)?.label ?? "Blue";
}
