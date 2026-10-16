import "server-only";

import type { Json } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { groupsToJson, type StageGroup } from "@/core/lib/stage-groups";
import type { ISODate } from "@/core/time";

import { asObject } from "./projects";

/**
 * The repository of ROADMAP 6b.16 (c)(d)(e) (migration `client_work_bulk_and_rounds`): one
 * transition function per call, so each bulk edit is one transaction (all or nothing) with one
 * audited row per deliverable. A raised error carries the function's own code and message.
 */

/** "+ Another revision round": the new stage's name. */
export async function addRevisionRound(itemId: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("item_add_revision_round", { item_id: itemId });
  if (error) throw error;
  return data;
}

/** "Keep this month's extra deliverables next month?": how many joined the list. */
export async function keepExtras(cycleId: string, keep: boolean): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("cycle_keep_extras", { cycle_id: cycleId, keep });
  if (error) throw error;
  return data;
}

export async function setPlannedDates(itemIds: readonly string[], date: ISODate): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("items_set_planned_date", {
    item_ids: [...itemIds],
    planned_date: date,
  });
  if (error) throw error;
  return data;
}

export async function shiftPlannedDates(itemIds: readonly string[], days: number): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("items_shift_planned_dates", {
    item_ids: [...itemIds],
    days,
  });
  if (error) throw error;
  return data;
}

export async function addStageGroupsTo(
  itemIds: readonly string[],
  groups: readonly StageGroup[],
): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("items_add_stage_groups", {
    item_ids: [...itemIds],
    stage_groups: groupsToJson(groups),
  });
  if (error) throw error;
  return data;
}

export type RenameRow = { id: string; from: string; to: string };

export async function renameItems(
  itemIds: readonly string[],
  pattern: string,
  start: number,
): Promise<RenameRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("items_rename", {
    item_ids: [...itemIds],
    pattern,
    start_at: start,
    apply: true,
  });
  if (error) throw error;
  return Array.isArray(data)
    ? data.map((value) => {
        const row = asObject(value as Json);
        return { id: String(row.id), from: String(row.from), to: String(row.to) };
      })
    : [];
}
