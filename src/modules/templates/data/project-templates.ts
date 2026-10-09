import "server-only";

import type { Json } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { AppError, isPostgresError } from "@/core/errors";
import { systemClock } from "@/core/time";

import type { ProjectTemplate, TemplateRecurrence } from "../domain/project-templates";

/**
 * Project templates (7.4): plain edits under RLS (`templates.manage` reads every template; an Admin
 * writes their own, the Owner any; `app.project_templates_guard()` keeps the author and checks the
 * stages, items and field defaults). Audited by `audit_row_change()`.
 */

function asObject(value: Json): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function listProjectTemplates(): Promise<ProjectTemplate[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("project_templates")
    .select(
      "id, name, description, recurrence, stages, items, field_defaults, archived_at, created_by",
    )
    .order("name");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    recurrence: row.recurrence as TemplateRecurrence,
    stages: row.stages,
    items: row.items,
    fieldDefaults: asObject(row.field_defaults),
    archived: row.archived_at !== null,
    createdBy: row.created_by,
  }));
}

export type ProjectTemplateValues = {
  name: string;
  description: string | null;
  recurrence: TemplateRecurrence;
  stages: string[];
  items: string[];
  fieldDefaults: Record<string, unknown>;
};

function row(values: ProjectTemplateValues) {
  return {
    name: values.name,
    description: values.description,
    recurrence: values.recurrence,
    stages: values.stages,
    items: values.items,
    field_defaults: values.fieldDefaults as Json,
  };
}

function nameTaken(error: unknown): never {
  if (isPostgresError(error) && error.code === "23505") {
    throw new AppError("CONFLICT", "Another template already uses this name.", {
      fieldErrors: { name: ["Another template already uses this name."] },
    });
  }
  throw error;
}

function notYours(): never {
  throw new AppError("NOT_FOUND", "This template is not one you can change.");
}

export async function createProjectTemplate(values: ProjectTemplateValues): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("project_templates").insert(row(values));
  if (error) nameTaken(error);
}

export async function updateProjectTemplate(id: string, values: ProjectTemplateValues) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("project_templates")
    .update(row(values))
    .eq("id", id)
    .select("id");
  if (error) nameTaken(error);
  if (!data || data.length === 0) notYours();
}

export async function setProjectTemplateArchived(id: string, archived: boolean) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("project_templates")
    .update({ archived_at: archived ? systemClock().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) notYours();
}
