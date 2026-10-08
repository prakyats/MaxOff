import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { AppError, isPostgresError } from "@/core/errors";
import { systemClock } from "@/core/time";

import type { StagePreset } from "../domain/stage-presets";

/**
 * Stage presets (7.4): plain edits under RLS (`lists.manage` reads every preset; an Admin writes
 * their own, the Owner any; `app.stage_presets_guard()` keeps the author and the stage names
 * right). Audited by `audit_row_change()`.
 */

export async function listStagePresets(): Promise<StagePreset[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("stage_presets")
    .select("id, name, stages, archived_at, created_by")
    .order("name");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    stages: row.stages,
    archived: row.archived_at !== null,
    createdBy: row.created_by,
  }));
}

/** No row came back: another author's preset (RLS), or gone. */
function notYours(): never {
  throw new AppError("NOT_FOUND", "This preset is not one you can change.");
}

function nameTaken(error: unknown): never {
  if (isPostgresError(error) && error.code === "23505") {
    throw new AppError("CONFLICT", "Another preset already uses this name.", {
      fieldErrors: { name: ["Another preset already uses this name."] },
    });
  }
  throw error;
}

export async function createStagePreset(values: { name: string; stages: string[] }) {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("stage_presets").insert(values);
  if (error) nameTaken(error);
}

export async function updateStagePreset(id: string, values: { name: string; stages: string[] }) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("stage_presets")
    .update(values)
    .eq("id", id)
    .select("id");
  if (error) nameTaken(error);
  if (!data || data.length === 0) notYours();
}

export async function setStagePresetArchived(id: string, archived: boolean) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("stage_presets")
    .update({ archived_at: archived ? systemClock().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) notYours();
}
