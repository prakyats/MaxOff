import "server-only";

import type { Json } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { type StageGroup, groupsToJson } from "@/core/lib/stage-groups";

/**
 * Save as template and a deliverable from a template's groups (6b Release 2; DATA-MODEL §5b
 * "Deliverable templates and Save as template"): each one transition function, which checks the
 * keys, the client's scope and the name, copies, and writes the history row.
 */

export async function saveProjectAsTemplate(projectId: string, name: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("project_save_as_template", {
    project_id: projectId,
    name,
  });
  if (error) throw error;
  return data;
}

export async function saveItemAsTemplate(itemId: string, name: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("item_save_as_template", { item_id: itemId, name });
  if (error) throw error;
  return data;
}

export async function addGroupedItem(args: {
  cycleId: string;
  title: string;
  plannedDate: string | null;
  notes: string | null;
  stageGroups: readonly StageGroup[];
}): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("item_add_grouped", {
    cycle_id: args.cycleId,
    title: args.title,
    ...(args.plannedDate ? { planned_date: args.plannedDate } : {}),
    ...(args.notes ? { notes: args.notes } : {}),
    stage_groups: groupsToJson(args.stageGroups) as Json,
  });
  if (error) throw error;
  return data;
}
