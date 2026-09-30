import "server-only";

import type { Database, Json } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";

import type { TaskFields } from "../domain/form";
import type { TaskRequest } from "../domain/requests";

/**
 * Task requests (4.6; WORKFLOWS §3.4, PERMISSIONS §2): read under RLS (the Owner all, an Admin
 * their own, those with no client and those labelled with their clients, Staff their own);
 * every change is a `task_request_*` transition function.
 */

type Functions = Database["public"]["Functions"];

/**
 * The request's columns, and its task when the viewer may open it: the embed goes through the
 * tasks' RLS, so it is null for a task the viewer cannot see (4C review S5: "Open the task" never
 * lands on the not-found screen).
 */
const COLUMNS =
  "id, requested_by, title, details, client_id, state, decided_by, decided_at, decision_reason, task_id, created_at, task:tasks!task_id(id)";

/** The requests the viewer sees: pending first, then the latest decided (at most `limit` of those). */
export async function listTaskRequests(limit: number): Promise<TaskRequest[]> {
  const supabase = await createServerSupabase();
  const [pending, decided] = await Promise.all([
    supabase
      .from("task_requests")
      .select(COLUMNS)
      .eq("state", "pending")
      .order("created_at", { ascending: true }),
    supabase
      .from("task_requests")
      .select(COLUMNS)
      .neq("state", "pending")
      .order("updated_at", { ascending: false })
      .limit(limit),
  ]);
  if (pending.error) throw pending.error;
  if (decided.error) throw decided.error;
  return [...pending.data, ...decided.data].map((row) => ({
    id: row.id,
    requestedBy: row.requested_by,
    title: row.title,
    details: row.details,
    clientId: row.client_id,
    state: row.state,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    taskId: row.task_id,
    taskVisible: row.task !== null,
    createdAt: row.created_at,
  }));
}

/**
 * How many pending requests the viewer may decide ("Needs you": suggested tasks to decide): the
 * ones RLS shows them, never their own (Kickoff 4 decision 23: an Admin's own suggestion goes to
 * the Owner; the Owner never suggests).
 */
export async function countRequestsToDecide(viewerId: string): Promise<number> {
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from("task_requests")
    .select("id", { count: "exact", head: true })
    .eq("state", "pending")
    .neq("requested_by", viewerId);
  if (error) throw error;
  return count ?? 0;
}

export async function rpcCreateRequest(input: {
  title: string;
  details: string | null;
  clientId: string | null;
}): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("task_request_create", {
    title: input.title,
    ...(input.details ? { details: input.details } : {}),
    ...(input.clientId ? { client_id: input.clientId } : {}),
  });
  if (error) throw error;
  return data;
}

export async function rpcWithdrawRequest(requestId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("task_request_withdraw", { request_id: requestId });
  if (error) throw error;
}

export async function rpcDeclineRequest(requestId: string, reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("task_request_decline", {
    request_id: requestId,
    reason,
  });
  if (error) throw error;
}

type WarningRow = { kind: string; member_id: string; details: Record<string, string | number> };

/** The task and the conversion, one transaction (`task_request_convert`). Returns the task id. */
export async function rpcConvertRequest(
  requestId: string,
  fields: TaskFields,
  options: {
    approvingAdminId: string | null;
    stages: string[];
    templateId: string | null;
    warnings: WarningRow[];
  },
): Promise<string> {
  const supabase = await createServerSupabase();
  const args = {
    request_id: requestId,
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
    template_id: options.templateId,
    warnings: options.warnings as unknown as Json,
  };
  // The function takes null for the optional ones (the generated types cannot say so).
  const { data, error } = await supabase.rpc(
    "task_request_convert",
    args as unknown as Functions["task_request_convert"]["Args"],
  );
  if (error) throw error;
  return data;
}
