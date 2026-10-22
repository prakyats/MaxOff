import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { unusedUsageFromJson, type UnusedUsage } from "@/core/lib/owner-delete";

/** The kinds Settings deletes when unused (V5a 6c): job titles, expense categories, custom fields. */
export type SettingsUnusedKind = "job_title" | "expense_category" | "field";

/**
 * The Owner-only Delete of what was never used (v1.8 V5a 6c): `unused_usage` says whether anything
 * has ever pointed at the row; `unused_delete` checks again with the row locked, writes the history
 * row first and deletes it. Both check the Owner in the database.
 */
export async function unusedUsage(kind: SettingsUnusedKind, id: string): Promise<UnusedUsage> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("unused_usage", { kind, target_id: id });
  if (error) throw error;
  return unusedUsageFromJson(data);
}

export async function deleteUnused(kind: SettingsUnusedKind, id: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("unused_delete", { kind, target_id: id });
  if (error) throw error;
}
