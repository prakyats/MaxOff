import "server-only";

import type { Json } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { AppError, isPostgresError } from "@/core/errors";
import { type StageGroup, groupsFromJson, groupsToJson } from "@/core/lib/stage-groups";
import { systemClock } from "@/core/time";

import type { DeliverableTemplate } from "../domain/deliverable-templates";

/**
 * Deliverable templates (6b Release 2): plain edits under RLS (`templates.manage` reads every
 * one; an Admin writes their own, the Owner any; `app.deliverable_templates_guard` keeps the
 * author, checks the groups and asks a reason for an archive). Audited by `audit_row_change()`.
 */

export async function listDeliverableTemplates(): Promise<DeliverableTemplate[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("deliverable_templates")
    .select("id, name, stage_groups, archived_at, archived_reason, created_by")
    // A deleted template (V5a 6b) is gone from every list and picker, archived ones included.
    .is("deleted_at", null)
    .order("name");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    stageGroups: groupsFromJson(row.stage_groups, []),
    archived: row.archived_at !== null,
    archivedReason: row.archived_reason,
    createdBy: row.created_by,
  }));
}

export type DeliverableTemplateValues = { name: string; stageGroups: StageGroup[] };

function nameTaken(error: unknown): never {
  if (isPostgresError(error) && error.code === "23505") {
    throw new AppError("CONFLICT", "Another deliverable template already uses this name.", {
      fieldErrors: { name: ["Another deliverable template already uses this name."] },
    });
  }
  throw error;
}

function notYours(): never {
  throw new AppError("NOT_FOUND", "This template is not one you can change.");
}

export async function createDeliverableTemplate(values: DeliverableTemplateValues): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("deliverable_templates")
    .insert({ name: values.name, stage_groups: groupsToJson(values.stageGroups) as Json });
  if (error) nameTaken(error);
}

export async function updateDeliverableTemplate(
  id: string,
  values: DeliverableTemplateValues,
): Promise<void> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("deliverable_templates")
    .update({ name: values.name, stage_groups: groupsToJson(values.stageGroups) as Json })
    .eq("id", id)
    .select("id");
  if (error) nameTaken(error);
  if (!data || data.length === 0) notYours();
}

/** Archive with a reason, or restore (`reason` null): the guard clears the reason with it. */
export async function setDeliverableTemplateArchived(
  id: string,
  reason: string | null,
): Promise<void> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("deliverable_templates")
    .update(
      reason === null
        ? { archived_at: null, archived_reason: null }
        : { archived_at: systemClock().toISOString(), archived_reason: reason },
    )
    .eq("id", id)
    .select("id");
  if (error) nameTaken(error);
  if (!data || data.length === 0) notYours();
}
