import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { onRefusal } from "@/core/errors";

/**
 * Counts one FORBIDDEN against the signed-in member (v7.5 Q6, owner 2026-11-26): their own row for
 * today (IST) in `access_refusals` goes up by one (`access_refusal_note()`, which takes no
 * argument, so nobody can count against someone else). The morning job tells the Owner about
 * anyone refused more than 20 times the day before (`access_refusals_daily`). A signed-out
 * caller counts nothing. Best effort: a failed count never changes the answer.
 */
export async function recordAccessRefusal(): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("access_refusal_note");
  if (error) throw error;
}

// The action wrapper's refusals (`core/errors/refusals.ts`) are counted here from the moment the
// server loads this file (`core/permissions/server.ts`, which every action uses, imports it).
onRefusal(recordAccessRefusal);
