import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { AppError, isPostgresError } from "@/core/errors";
import { nextPosition } from "@/core/lists";
import { systemClock } from "@/core/time";

import type { TaskTypeSetting } from "../domain/task-types";
import type { TaskTypeKind } from "../domain/types";

/**
 * Settings → Task types (4C): plain edits under RLS (insert and update need `settings.manage`,
 * and `app.task_types_owner_guard()` refuses anyone else, Kickoff 4 decision 15); the order moves
 * through `task_type_move()`. Audited by `audit_row_change()`.
 */

/** Every type, archived ones included, with the columns the editor shows. */
export async function listTaskTypeSettings(): Promise<TaskTypeSetting[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("task_types")
    .select("id, name, kind, shows_on_calendar, has_location, archived_at, position")
    .order("position", { ascending: true });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    showsOnCalendar: row.shows_on_calendar,
    hasLocation: row.has_location,
    archivedAt: row.archived_at,
    position: row.position,
  }));
}

/** unique (org_id, lower(btrim(name))) where archived_at is null. */
function friendlyConflict(error: unknown): never {
  if (isPostgresError(error) && error.code === "23505") {
    const message = "There is already a task type with that name.";
    throw new AppError("CONFLICT", message, { fieldErrors: { name: [message] } });
  }
  throw error;
}

/** A new type goes last in the Owner's order. */
export async function insertTaskType(values: {
  name: string;
  kind: TaskTypeKind;
  showsOnCalendar: boolean;
  hasLocation: boolean;
}): Promise<string> {
  const supabase = await createServerSupabase();
  const { data: last, error: lastError } = await supabase
    .from("task_types")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;
  const { data, error } = await supabase
    .from("task_types")
    .insert({
      name: values.name,
      kind: values.kind,
      shows_on_calendar: values.showsOnCalendar,
      has_location: values.hasLocation,
      position: nextPosition(last?.position ?? null),
    })
    .select("id")
    .single();
  if (error) friendlyConflict(error);
  return data.id;
}

export async function updateTaskType(
  id: string,
  values: { name: string; showsOnCalendar: boolean; hasLocation: boolean },
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("task_types")
    .update(
      {
        name: values.name,
        shows_on_calendar: values.showsOnCalendar,
        has_location: values.hasLocation,
      },
      { count: "exact" },
    )
    .eq("id", id);
  if (error) friendlyConflict(error);
  if (count === 0) throw new AppError("NOT_FOUND", "This task type is gone.");
}

/** Archived, never deleted (invariant 9): open tasks keep it; new tasks are not offered it. */
export async function setTaskTypeArchived(id: string, archived: boolean): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("task_types")
    .update({ archived_at: archived ? systemClock().toISOString() : null }, { count: "exact" })
    .eq("id", id);
  if (error) friendlyConflict(error);
  if (count === 0) throw new AppError("NOT_FOUND", "This task type is gone.");
}

export async function rpcMoveTaskType(id: string, direction: "up" | "down"): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("task_type_move", { task_type_id: id, direction });
  if (error) throw error;
}
