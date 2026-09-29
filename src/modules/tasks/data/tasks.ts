import "server-only";

import { listActivity } from "@/core/activity/server";
import type { ActivityEntry } from "@/core/activity";
import type { Database, Json, Tables } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { AppError } from "@/core/errors";
import { nextPosition } from "@/core/lists";
import { systemClock } from "@/core/time";

import type { TaskChanges, TaskFields } from "../domain/form";
import type {
  ReviewDecision,
  Task,
  TaskAssignee,
  TaskComment,
  TaskReview,
  TaskStage,
  TaskState,
  TaskSubmission,
  TaskType,
} from "../domain/types";
import type { AvailabilityDay, LeaveMark } from "../domain/warnings";

/**
 * The tasks repository (CLAUDE.md rule 3; ARCHITECTURE §4). Reads run under RLS as the signed-in
 * member, so `app.task_visible()` decides what exists (a task someone may not see simply is not
 * there). Every workflow change is a `task_*` transition function (4A, ADR-0006); the two plain
 * API paths are a stage (a manager's add or remove, a worker's tick) and a comment, each checked
 * by its guard trigger and audited by `audit_row_change()`.
 */

type Functions = Database["public"]["Functions"];

/** The generated argument types mark some nullable parameters as plain strings: null is valid. */
type Nullable<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };

function toTask(row: Tables<"tasks">): Task {
  const custom = row.custom_fields;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    taskTypeId: row.task_type_id,
    clientId: row.client_id,
    priority: row.priority,
    dueAt: row.due_at,
    eventDate: row.event_date,
    eventStartAt: row.event_start_at,
    eventEndAt: row.event_end_at,
    location: row.location,
    purpose: row.purpose,
    state: row.state,
    approvingAdminId: row.approving_admin_id,
    adminStep: row.admin_step,
    createdBy: row.created_by,
    primaryOwnerId: row.primary_owner_id,
    lateReason: row.late_reason,
    cancelledReason: row.cancelled_reason,
    customFields:
      custom !== null && typeof custom === "object" && !Array.isArray(custom)
        ? (custom as Record<string, unknown>)
        : {},
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by,
    submittedOnBehalfOf: row.submitted_on_behalf_of,
    adminApprovedAt: row.admin_approved_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
  };
}

/** Every task type, archived ones included (a task keeps its type), in the Owner's order. */
export async function listTaskTypes(): Promise<TaskType[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("task_types")
    .select("id, name, kind, has_location, archived_at, position")
    .order("position", { ascending: true });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    hasLocation: row.has_location,
    archived: row.archived_at !== null,
  }));
}

/** One task, or null when it does not exist or the viewer may not see it (RLS). */
export async function getTask(id: string): Promise<Task | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toTask(data) : null;
}

/** Everyone ever on the task, removed people included (the history names them). */
export async function listAssignees(taskId: string): Promise<TaskAssignee[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("task_assignees")
    .select("member_id, is_primary, assigned_at, acknowledged_at, acknowledged_by, removed_at")
    .eq("task_id", taskId)
    .order("assigned_at", { ascending: true });
  if (error) throw error;
  return data.map((row) => ({
    memberId: row.member_id,
    isPrimary: row.is_primary,
    assignedAt: row.assigned_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    removedAt: row.removed_at,
  }));
}

export async function listStages(taskId: string): Promise<TaskStage[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("task_stages")
    .select("id, name, position, done_at, done_by, on_behalf_of")
    .eq("task_id", taskId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    doneAt: row.done_at,
    doneBy: row.done_by,
    onBehalfOf: row.on_behalf_of,
  }));
}

/** The comments, oldest first (a timeline reads down). */
export async function listComments(taskId: string): Promise<TaskComment[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("task_comments")
    .select("id, author_id, on_behalf_of, body, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    authorId: row.author_id,
    onBehalfOf: row.on_behalf_of,
    body: row.body,
    createdAt: row.created_at,
  }));
}

/** The hand-ins, newest version first. */
export async function listSubmissions(taskId: string): Promise<TaskSubmission[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("task_submissions")
    .select("id, version, note, submitted_by, on_behalf_of, at")
    .eq("task_id", taskId)
    .order("version", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    version: row.version,
    note: row.note,
    submittedBy: row.submitted_by,
    onBehalfOf: row.on_behalf_of,
    at: row.at,
  }));
}

export async function listReviews(taskId: string): Promise<TaskReview[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("task_reviews")
    .select("id, step, decision, reason, reviewer_id, at")
    .eq("task_id", taskId)
    .order("at", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    step: row.step === "owner" ? "owner" : "admin",
    decision: row.decision,
    reason: row.reason,
    reviewerId: row.reviewer_id,
    at: row.at,
  }));
}

/** Every task table audits with `entity_id` = the task (4A), so one read covers its history. */
const TASK_ENTITIES = [
  "tasks",
  "task_assignees",
  "task_stages",
  "task_comments",
  "task_reviews",
  "task_submissions",
  "task_warnings",
] as const;

/**
 * The task's history, newest first, under RLS: a Staff viewer gets no `task_warnings` entries
 * (4A review M1: they are `availability.view`'s).
 */
export async function listTaskActivity(taskId: string): Promise<ActivityEntry[]> {
  return listActivity(TASK_ENTITIES.map((entity) => ({ entity, ids: [taskId] })));
}

// Warnings (4.3) -----------------------------------------------------------------------------------

const LEAVE_MARKS: readonly LeaveMark[] = ["leave", "half_day", "comp_leave", "requested"];

function toBlocks(value: Json): { startAt: string; endAt: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    if (block === null || typeof block !== "object" || Array.isArray(block)) return [];
    const start = block.start_at;
    const end = block.end_at;
    return typeof start === "string" && typeof end === "string"
      ? [{ startAt: start, endAt: end }]
      : [];
  });
}

/**
 * The people's availability on the given IST days (`member_availability()`, 4A): counts, busy
 * blocks and leave, never anyone's tasks (ADR-0004). One call per day, so a deadline and an event
 * far apart never ask for a range of months.
 */
export async function availability(
  days: readonly string[],
  memberIds: readonly string[],
): Promise<AvailabilityDay[]> {
  const supabase = await createServerSupabase();
  const answers = await Promise.all(
    days.map((day) =>
      supabase.rpc("member_availability", {
        from_date: day,
        to_date: day,
        member_ids: [...memberIds],
      }),
    ),
  );
  return answers.flatMap(({ data, error }) => {
    if (error) throw error;
    return data.map((row) => ({
      memberId: row.member_id,
      day: row.day,
      openTasksDue: row.open_tasks_due,
      eventBlocks: toBlocks(row.event_blocks),
      leave: (LEAVE_MARKS as readonly string[]).includes(row.leave)
        ? (row.leave as LeaveMark)
        : null,
    }));
  });
}

// Transition functions (ADR-0006) --------------------------------------------------------------------

type WarningRow = { kind: string; member_id: string; details: Record<string, string | number> };

export async function rpcCreateTask(
  fields: TaskFields,
  options: { approvingAdminId: string | null; stages: string[]; warnings: WarningRow[] },
): Promise<string> {
  const supabase = await createServerSupabase();
  const args: Nullable<
    Functions["task_create"]["Args"],
    | "client_id"
    | "description"
    | "approving_admin_id"
    | "event_date"
    | "event_start_at"
    | "event_end_at"
    | "location"
    | "purpose"
  > = {
    title: fields.title,
    description: fields.description,
    task_type_id: fields.taskTypeId,
    client_id: fields.clientId,
    priority: fields.priority,
    due_at: fields.dueAt,
    assignee_ids: fields.assigneeIds,
    primary_owner_id: fields.primaryOwnerId,
    approving_admin_id: options.approvingAdminId,
    event_date: fields.eventDate,
    event_start_at: fields.eventStartAt,
    event_end_at: fields.eventEndAt,
    location: fields.location,
    purpose: fields.purpose,
    stages: options.stages,
    custom_fields: fields.customFields as Json,
    warnings: options.warnings as unknown as Json,
  };
  // The function takes null for each of these (the generated types cannot say so).
  const { data, error } = await supabase.rpc(
    "task_create",
    args as unknown as Functions["task_create"]["Args"],
  );
  if (error) throw error;
  return data;
}

/** camelCase changes → the jsonb keys `task_update_assignment` reads (4A mechanics 4). */
const CHANGE_KEYS: Record<keyof TaskChanges, string> = {
  title: "title",
  description: "description",
  taskTypeId: "task_type_id",
  clientId: "client_id",
  priority: "priority",
  dueAt: "due_at",
  eventDate: "event_date",
  eventStartAt: "event_start_at",
  eventEndAt: "event_end_at",
  location: "location",
  purpose: "purpose",
  customFields: "custom_fields",
  assigneeIds: "assignee_ids",
  primaryOwnerId: "primary_owner_id",
};

export async function rpcUpdateTask(
  taskId: string,
  changes: { [K in keyof TaskChanges]?: TaskChanges[K] | undefined },
  warnings: WarningRow[],
): Promise<string[]> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    const column = CHANGE_KEYS[key as keyof TaskChanges];
    if (column && value !== undefined) payload[column] = value;
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("task_update_assignment", {
    task_id: taskId,
    changes: payload as Json,
    warnings: warnings as unknown as Json,
  });
  if (error) throw error;
  return data;
}

export async function rpcAcknowledge(taskId: string, onBehalfOf: string | null): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("task_acknowledge", {
    task_id: taskId,
    ...(onBehalfOf ? { on_behalf_of: onBehalfOf } : {}),
  });
  if (error) throw error;
}

export async function rpcStart(taskId: string, onBehalfOf: string | null): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("task_start", {
    task_id: taskId,
    ...(onBehalfOf ? { on_behalf_of: onBehalfOf } : {}),
  });
  if (error) throw error;
}

export async function rpcSubmitDone(input: {
  taskId: string;
  note: string | null;
  lateReason: string | null;
  onBehalfOf: string | null;
}): Promise<TaskState> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("task_submit_done", {
    task_id: input.taskId,
    ...(input.note ? { note: input.note } : {}),
    ...(input.lateReason ? { late_reason: input.lateReason } : {}),
    ...(input.onBehalfOf ? { on_behalf_of: input.onBehalfOf } : {}),
  });
  if (error) throw error;
  return data;
}

export async function rpcReview(
  taskId: string,
  decision: ReviewDecision,
  reason: string | null,
): Promise<TaskState> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("task_review", {
    task_id: taskId,
    decision,
    ...(reason ? { reason } : {}),
  });
  if (error) throw error;
  return data;
}

export async function rpcCancel(taskId: string, reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("task_cancel", { task_id: taskId, reason });
  if (error) throw error;
}

export async function rpcReopen(taskId: string, reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("task_reopen", { task_id: taskId, reason });
  if (error) throw error;
}

/** The Owner's approver change; null sends the task to the Owner (4A mechanics 5). */
export async function rpcSetApprover(
  taskId: string,
  approvingAdminId: string | null,
): Promise<TaskState> {
  const supabase = await createServerSupabase();
  const args: Nullable<Functions["task_set_approver"]["Args"], "approving_admin_id"> = {
    task_id: taskId,
    approving_admin_id: approvingAdminId,
  };
  const { data, error } = await supabase.rpc(
    "task_set_approver",
    args as unknown as Functions["task_set_approver"]["Args"],
  );
  if (error) throw error;
  return data;
}

// The plain paths: stages and comments (guarded, audited) ------------------------------------------

/**
 * A worker's tick or untick. `done_by` is set by the guard to the caller; the tick's time is the
 * server's. A refused tick matches no row under RLS, or raises from the guard.
 */
export async function setStageDone(input: {
  taskId: string;
  stageId: string;
  done: boolean;
  onBehalfOf: string | null;
}): Promise<void> {
  const supabase = await createServerSupabase();
  const patch = input.done
    ? { done_at: systemClock().toISOString(), on_behalf_of: input.onBehalfOf }
    : { done_at: null, done_by: null, on_behalf_of: null };
  const { error, count } = await supabase
    .from("task_stages")
    .update(patch, { count: "exact" })
    .eq("id", input.stageId)
    .eq("task_id", input.taskId);
  if (error) throw error;
  if (count === 0) throw new AppError("NOT_FOUND", "This stage is gone. Refresh the task.");
}

/** A manager's new stage, after the last one. */
export async function addStage(taskId: string, name: string): Promise<void> {
  const supabase = await createServerSupabase();
  const last = await supabase
    .from("task_stages")
    .select("position")
    .eq("task_id", taskId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last.error) throw last.error;
  const { error } = await supabase
    .from("task_stages")
    .insert({ task_id: taskId, name, position: nextPosition(last.data?.position ?? null) });
  if (error) throw error;
}

/** A manager removes an unticked stage (a ticked one stays: the guard refuses). */
export async function removeStage(taskId: string, stageId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("task_stages")
    .delete({ count: "exact" })
    .eq("id", stageId)
    .eq("task_id", taskId);
  if (error) throw error;
  if (count === 0) throw new AppError("NOT_FOUND", "This stage is gone. Refresh the task.");
}

/** A comment, as the caller or for a freelancer they coordinate (the guard checks, ADR-0013). */
export async function addComment(input: {
  taskId: string;
  body: string;
  onBehalfOf: string | null;
}): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("task_comments").insert({
    task_id: input.taskId,
    body: input.body,
    ...(input.onBehalfOf ? { on_behalf_of: input.onBehalfOf } : {}),
  });
  if (error) throw error;
}
