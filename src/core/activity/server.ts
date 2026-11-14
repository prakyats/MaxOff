import "server-only";

import type { Tables } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";

import { ACTIVITY_LIMIT, type ActivityEntry, type ActivityTarget } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY = /^[a-z_]+$/;

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** An activity_log row as the history reads it. */
export type ActivityRow = Pick<
  Tables<"activity_log">,
  "id" | "actor_id" | "on_behalf_of_id" | "entity" | "entity_id" | "action" | "diff" | "meta" | "at"
>;

/** History entries from their rows, as `listActivity` reads them or a page's one read carries them. */
export function activityFrom(rows: readonly ActivityRow[]): ActivityEntry[] {
  return rows.map((row) => {
    const diff = asObject(row.diff);
    return {
      id: row.id,
      actorId: row.actor_id,
      onBehalfOfId: row.on_behalf_of_id,
      entity: row.entity,
      entityId: row.entity_id,
      action: row.action,
      old: asObject(diff.old),
      new: asObject(diff.new),
      meta: asObject(row.meta),
      at: row.at,
    };
  });
}

/**
 * The latest entries about the given rows, newest first, under RLS: an entry the viewer may not
 * read (an Owner-only table, another Admin's client) is simply not returned. Ids are checked to
 * be uuids before they reach the filter, so nothing from a URL is ever spliced into it raw.
 */
export async function listActivity(
  targets: readonly ActivityTarget[],
  limit: number = ACTIVITY_LIMIT,
): Promise<ActivityEntry[]> {
  const clauses = targets
    .filter((target) => ENTITY.test(target.entity))
    .map((target) => ({ ...target, ids: target.ids.filter((id) => UUID.test(id)) }))
    .filter((target) => target.ids.length > 0)
    .map((target) => `and(entity.eq.${target.entity},entity_id.in.(${target.ids.join(",")}))`);
  if (clauses.length === 0) return [];

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, actor_id, on_behalf_of_id, entity, entity_id, action, diff, meta, at")
    .or(clauses.join(","))
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return activityFrom(data);
}
