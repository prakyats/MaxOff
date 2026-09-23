import "server-only";

import type { Tables } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { systemClock } from "@/core/time";

import type { ListKey } from "./registry";
import { type ListItemInput, listItemInputSchema, nextPosition } from "./schemas";

export type ListItem = Tables<"list_items">;

/** The shape a picker needs. */
export type ListOption = Pick<ListItem, "id" | "name" | "color" | "icon" | "archived_at">;

/**
 * The entries of a list in display order, under RLS (every active member may read; writes need
 * `lists.manage`, which the caller's action asserts first). Archived entries are left out unless
 * asked for, since a form must not offer them while a directory may still have to name them.
 */
export async function listItems(
  listKey: ListKey,
  options: { includeArchived?: boolean } = {},
): Promise<ListItem[]> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("list_items")
    .select("*")
    .eq("list_key", listKey)
    .order("position", { ascending: true });
  if (!options.includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function listOptions(listKey: ListKey): Promise<ListOption[]> {
  const items = await listItems(listKey);
  return items.map(({ id, name, color, icon, archived_at }) => ({
    id,
    name,
    color,
    icon,
    archived_at,
  }));
}

/** Appends an entry after the last one. Audited by the table's trigger. */
export async function createListItem(listKey: ListKey, input: ListItemInput): Promise<ListItem> {
  const values = listItemInputSchema.parse(input);
  const supabase = await createServerSupabase();
  const { data: last, error: lastError } = await supabase
    .from("list_items")
    .select("position")
    .eq("list_key", listKey)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;

  const { data, error } = await supabase
    .from("list_items")
    .insert({
      list_key: listKey,
      name: values.name,
      description: values.description ?? null,
      color: values.color ?? null,
      icon: values.icon ?? null,
      position: nextPosition(last?.position ?? null),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateListItem(id: string, input: ListItemInput): Promise<ListItem> {
  const values = listItemInputSchema.parse(input);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("list_items")
    .update({
      name: values.name,
      description: values.description ?? null,
      color: values.color ?? null,
      icon: values.icon ?? null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Entries are never deleted (CLAUDE.md invariant 9): archiving hides them from pickers. */
export async function archiveListItem(id: string, archived: boolean): Promise<ListItem> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("list_items")
    .update({ archived_at: archived ? systemClock().toISOString() : null })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
