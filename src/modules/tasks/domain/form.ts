import { type ISODate, istInstant, isISODate, isISTTime, toISTDate, toISTTime } from "@/core/time";

import {
  DEFAULT_DUE_TIME,
  DESCRIPTION_MAX,
  LOCATION_MAX,
  PURPOSE_MAX,
  STAGE_NAME_MAX,
  STAGES_MAX,
  TITLE_MAX,
} from "./limits";
import { activeAssignees } from "./task";
import type { Priority, Task, TaskAssignee, TaskType } from "./types";
import { type EventWindow, eventWindow } from "./warnings";

/**
 * The create / edit dialog's draft (4.3), as typed: dates and times apart, strings everywhere a
 * field can be empty. `taskFromDraft` turns it into the instants and nulls the functions take;
 * `draftChanges` says what an edit changed, so `task_update_assignment` gets only that (4A
 * mechanics 4: it answers "Nothing changed" otherwise).
 */
export type TaskDraft = {
  title: string;
  description: string;
  /** "" = the default type (the first active one, "Normal" as seeded). */
  taskTypeId: string;
  /** "" = no client label. */
  clientId: string;
  priority: Priority;
  dueDate: string;
  dueTime: string;
  eventDate: string;
  eventStart: string;
  eventEnd: string;
  location: string;
  purpose: string;
  assigneeIds: string[];
  primaryOwnerId: string;
  /** The Owner's choice of approving Admin: "" = the Owner approves directly. */
  approverId: string;
  stages: string[];
  customFields: Record<string, unknown>;
};

export function emptyDraft(): TaskDraft {
  return {
    title: "",
    description: "",
    taskTypeId: "",
    clientId: "",
    // Kickoff 4 decision 4: priority defaults to Medium, the time to 6:00 PM IST.
    priority: "medium",
    dueDate: "",
    dueTime: DEFAULT_DUE_TIME,
    eventDate: "",
    eventStart: "",
    eventEnd: "",
    location: "",
    purpose: "",
    assigneeIds: [],
    primaryOwnerId: "",
    approverId: "",
    stages: [],
    customFields: {},
  };
}

/** The edit dialog starts from the task as it stands (its active assignees, its primary owner). */
export function draftFromTask(task: Task, assignees: readonly TaskAssignee[]): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    taskTypeId: task.taskTypeId,
    clientId: task.clientId ?? "",
    priority: task.priority,
    dueDate: toISTDate(task.dueAt),
    dueTime: toISTTime(task.dueAt),
    eventDate: task.eventDate ?? "",
    eventStart: task.eventStartAt ? toISTTime(task.eventStartAt) : "",
    eventEnd: task.eventEndAt ? toISTTime(task.eventEndAt) : "",
    location: task.location ?? "",
    purpose: task.purpose ?? "",
    assigneeIds: activeAssignees(assignees).map((a) => a.memberId),
    primaryOwnerId: task.primaryOwnerId,
    approverId: task.approvingAdminId ?? "",
    stages: [],
    customFields: { ...task.customFields },
  };
}

/** The type the draft really has: its own, or the default (the first active type). */
export function draftType(draft: TaskDraft, types: readonly TaskType[]): TaskType | null {
  const active = types.filter((type) => !type.archived);
  return types.find((type) => type.id === draft.taskTypeId) ?? active[0] ?? null;
}

/**
 * Adds a person; the first one becomes the primary owner. Picking the same person again changes
 * nothing.
 */
export function addAssignee(draft: TaskDraft, memberId: string): TaskDraft {
  if (draft.assigneeIds.includes(memberId)) return draft;
  return {
    ...draft,
    assigneeIds: [...draft.assigneeIds, memberId],
    primaryOwnerId: draft.primaryOwnerId || memberId,
  };
}

/** Removes a person; when it was the primary owner the next one takes over. */
export function removeAssignee(draft: TaskDraft, memberId: string): TaskDraft {
  const assigneeIds = draft.assigneeIds.filter((id) => id !== memberId);
  const primaryOwnerId =
    draft.primaryOwnerId === memberId ? (assigneeIds[0] ?? "") : draft.primaryOwnerId;
  return { ...draft, assigneeIds, primaryOwnerId };
}

export type DraftErrors = Partial<
  Record<
    | "title"
    | "taskTypeId"
    | "assigneeIds"
    | "dueDate"
    | "dueTime"
    | "eventDate"
    | "eventStart"
    | "eventEnd"
    | "location"
    | "purpose"
    | "description"
    | "stages",
    string
  >
>;

/**
 * The form's own checks, before anything is sent (the functions check again): a title, someone
 * to do it, a deadline in the future when creating (kickoff 4 decision 4; an edit may move it
 * anywhere), an event's date and a sane window.
 */
export function validateDraft(
  draft: TaskDraft,
  type: TaskType | null,
  options: { creating: boolean; now: Date },
): DraftErrors {
  const errors: DraftErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = "Give the task a title.";
  else if (title.length > TITLE_MAX) errors.title = `Keep the title under ${TITLE_MAX} characters.`;
  if (draft.description.trim().length > DESCRIPTION_MAX) {
    errors.description = `Keep the description under ${DESCRIPTION_MAX} characters.`;
  }
  if (!type) errors.taskTypeId = "Choose a task type.";
  if (draft.assigneeIds.length === 0) errors.assigneeIds = "Assign at least one person.";

  if (!isISODate(draft.dueDate)) errors.dueDate = "Pick the deadline's date.";
  else if (!isISTTime(draft.dueTime)) errors.dueTime = "Pick the deadline's time.";
  else if (
    options.creating &&
    Date.parse(istInstant(draft.dueDate, draft.dueTime)) <= options.now.getTime()
  ) {
    errors.dueDate = "The deadline has already passed. Pick a later time.";
  }

  if (type?.kind === "event") {
    if (!isISODate(draft.eventDate)) errors.eventDate = "Pick the event's date.";
    if (draft.eventEnd && !draft.eventStart) errors.eventStart = "An end time needs a start time.";
    if (draft.eventStart && !isISTTime(draft.eventStart)) errors.eventStart = "Pick a start time.";
    if (draft.eventEnd && !isISTTime(draft.eventEnd)) errors.eventEnd = "Pick an end time.";
    if (
      !errors.eventStart &&
      !errors.eventEnd &&
      draft.eventStart &&
      draft.eventEnd &&
      draft.eventEnd <= draft.eventStart
    ) {
      errors.eventEnd = "The event ends after it starts.";
    }
    if (draft.purpose.trim().length > PURPOSE_MAX) {
      errors.purpose = `Keep the purpose under ${PURPOSE_MAX} characters.`;
    }
  }
  if (type?.hasLocation && draft.location.trim().length > LOCATION_MAX) {
    errors.location = `Keep the location under ${LOCATION_MAX} characters.`;
  }
  const stages = draft.stages.map((stage) => stage.trim());
  if (stages.some((stage) => stage.length === 0)) errors.stages = "Name each stage, or remove it.";
  else if (stages.some((stage) => stage.length > STAGE_NAME_MAX)) {
    errors.stages = `Keep each stage under ${STAGE_NAME_MAX} characters.`;
  } else if (stages.length > STAGES_MAX) {
    errors.stages = `Up to ${STAGES_MAX} stages.`;
  }
  return errors;
}

/** The task's fields as the functions take them: instants, nulls, only what the type carries. */
export type TaskFields = {
  title: string;
  description: string | null;
  taskTypeId: string;
  clientId: string | null;
  priority: Priority;
  dueAt: string;
  eventDate: ISODate | null;
  eventStartAt: string | null;
  eventEndAt: string | null;
  location: string | null;
  purpose: string | null;
  assigneeIds: string[];
  primaryOwnerId: string;
  customFields: Record<string, unknown>;
};

function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** A valid draft (`validateDraft` answered nothing) as the fields to send. */
export function taskFromDraft(draft: TaskDraft, type: TaskType): TaskFields {
  const event = type.kind === "event";
  const eventDate = event && isISODate(draft.eventDate) ? draft.eventDate : null;
  return {
    title: draft.title.trim(),
    description: textOrNull(draft.description),
    taskTypeId: type.id,
    clientId: draft.clientId || null,
    priority: draft.priority,
    dueAt: istInstant(draft.dueDate, draft.dueTime),
    eventDate,
    eventStartAt: eventDate && draft.eventStart ? istInstant(eventDate, draft.eventStart) : null,
    eventEndAt: eventDate && draft.eventEnd ? istInstant(eventDate, draft.eventEnd) : null,
    location: type.hasLocation ? textOrNull(draft.location) : null,
    purpose: event ? textOrNull(draft.purpose) : null,
    assigneeIds: [...draft.assigneeIds],
    primaryOwnerId: draft.primaryOwnerId,
    customFields: draft.customFields,
  };
}

/** The task as it stands, in the same shape: the "before" of an edit. */
export function fieldsFromTask(task: Task, assignees: readonly TaskAssignee[]): TaskFields {
  return {
    title: task.title,
    description: task.description,
    taskTypeId: task.taskTypeId,
    clientId: task.clientId,
    priority: task.priority,
    dueAt: task.dueAt,
    eventDate: task.eventDate,
    eventStartAt: task.eventStartAt,
    eventEndAt: task.eventEndAt,
    location: task.location,
    purpose: task.purpose,
    assigneeIds: activeAssignees(assignees).map((a) => a.memberId),
    primaryOwnerId: task.primaryOwnerId,
    customFields: task.customFields,
  };
}

/** The draft's event window, when it has a start time (for the overlap warning). */
export function draftEventWindow(draft: TaskDraft, type: TaskType | null): EventWindow | null {
  if (type?.kind !== "event" || !isISODate(draft.eventDate) || !isISTTime(draft.eventStart)) {
    return null;
  }
  const start = istInstant(draft.eventDate, draft.eventStart);
  const end = isISTTime(draft.eventEnd) ? istInstant(draft.eventDate, draft.eventEnd) : null;
  return eventWindow(start, end);
}

/** The keys `task_update_assignment` takes (4A mechanics 4), camelCase. */
export type TaskChanges = Partial<Omit<TaskFields, "assigneeIds">> & { assigneeIds?: string[] };

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function sameValues(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  return true;
}

/**
 * Two instants as the same moment: the task's own come from PostgREST (`…+00:00`), the dialog's
 * from `istInstant` (`….000Z`), so the strings differ for the same time.
 */
function sameInstant(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : Date.parse(a) === Date.parse(b);
}

/**
 * What an edit changes: only the keys whose value differs from the task as it stands, so the
 * function's audit names exactly what moved. Custom-field keys the new type does not carry are
 * dropped with a type change (4A later item L4) by the caller, through `keepFieldKeys`.
 */
export function draftChanges(before: TaskFields, after: TaskFields): TaskChanges {
  const changes: TaskChanges = {};
  const scalar = [
    "title",
    "description",
    "taskTypeId",
    "clientId",
    "priority",
    "eventDate",
    "location",
    "purpose",
    "primaryOwnerId",
  ] as const;
  for (const key of scalar) {
    if (before[key] !== after[key]) Object.assign(changes, { [key]: after[key] });
  }
  for (const key of ["dueAt", "eventStartAt", "eventEndAt"] as const) {
    if (!sameInstant(before[key], after[key])) Object.assign(changes, { [key]: after[key] });
  }
  if (!sameSet(before.assigneeIds, after.assigneeIds)) changes.assigneeIds = [...after.assigneeIds];
  if (!sameValues(before.customFields, after.customFields))
    changes.customFields = after.customFields;
  return changes;
}

/** Only the custom-field values whose definitions apply to the task's type. */
export function keepFieldKeys(
  values: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => keys.includes(key)));
}

/** Has the person changed anything since the dialog opened? (Back then asks first, §14.2 f.) */
export function isDraftDirty(initial: TaskDraft, draft: TaskDraft): boolean {
  return JSON.stringify(initial) !== JSON.stringify(draft);
}

/** The people an edit adds, and whether the deadline's day or the event moved (warnings). */
export function assignmentChange(
  before: TaskFields,
  after: TaskFields,
): { added: string[]; datesMoved: boolean } {
  const added = after.assigneeIds.filter((id) => !before.assigneeIds.includes(id));
  const datesMoved =
    toISTDate(before.dueAt) !== toISTDate(after.dueAt) ||
    before.eventDate !== after.eventDate ||
    !sameInstant(before.eventStartAt, after.eventStartAt) ||
    !sameInstant(before.eventEndAt, after.eventEndAt);
  return { added, datesMoved };
}
