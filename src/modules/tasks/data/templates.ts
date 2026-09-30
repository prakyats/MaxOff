import "server-only";

import type { Json } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { AppError, isPostgresError } from "@/core/errors";
import { systemClock } from "@/core/time";

import type { Priority } from "../domain/types";
import type { TaskTemplate } from "../domain/templates";

/**
 * Task templates (4.6): a plain edit under RLS (templates.manage reads every template; an Admin
 * writes their own, the Owner any; `app.task_templates_guard()` keeps the author, the type and
 * the stages right). Audited by `audit_row_change()`.
 */

const COLUMNS =
  "id, name, task_type_id, description, default_priority, stages, field_defaults, archived_at, created_by";

function asObject(value: Json): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Every template the viewer may use, archived ones included (Settings lists them apart). */
export async function listTaskTemplates(): Promise<TaskTemplate[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("task_templates").select(COLUMNS).order("name");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    taskTypeId: row.task_type_id,
    description: row.description,
    defaultPriority: row.default_priority,
    stages: row.stages,
    fieldDefaults: asObject(row.field_defaults),
    archived: row.archived_at !== null,
    createdBy: row.created_by,
  }));
}

export type TemplateValues = {
  name: string;
  taskTypeId: string;
  description: string | null;
  defaultPriority: Priority;
  stages: string[];
  fieldDefaults: Record<string, unknown>;
};

function row(values: TemplateValues) {
  return {
    name: values.name,
    task_type_id: values.taskTypeId,
    description: values.description,
    default_priority: values.defaultPriority,
    stages: values.stages,
    field_defaults: values.fieldDefaults as Json,
  };
}

/** unique (org_id, lower(btrim(name))) where archived_at is null. */
function friendlyConflict(error: unknown): never {
  if (isPostgresError(error) && error.code === "23505") {
    throw new AppError("CONFLICT", "There is already a template with that name.", {
      fieldErrors: { name: ["There is already a template with that name."] },
    });
  }
  throw error;
}

export async function createTemplate(values: TemplateValues): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("task_templates")
    .insert(row(values))
    .select("id")
    .single();
  if (error) friendlyConflict(error);
  return data.id;
}

/** An edit: RLS matches no row when it is not the viewer's to change (or it is gone). */
export async function updateTemplate(id: string, values: TemplateValues): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("task_templates")
    .update(row(values), { count: "exact" })
    .eq("id", id);
  if (error) friendlyConflict(error);
  if (count === 0)
    throw new AppError("NOT_FOUND", "This template is gone, or it is not yours to change.");
}

export async function setTemplateArchived(id: string, archived: boolean): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("task_templates")
    .update({ archived_at: archived ? systemClock().toISOString() : null }, { count: "exact" })
    .eq("id", id);
  if (error) friendlyConflict(error);
  if (count === 0)
    throw new AppError("NOT_FOUND", "This template is gone, or it is not yours to change.");
}
