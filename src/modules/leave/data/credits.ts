import "server-only";

import { withDeadlockRetry } from "@/core/db/retry";
import { createServerSupabase } from "@/core/db/server";

import type { CompBalance, CompCredit } from "../domain/credits";

/**
 * Comp leave credits (CLAUDE.md rule 3; DATA-MODEL §3 `comp_leave_credits`). Reads go through
 * RLS (own rows, or everyone's for `attendance.view_all`) and the `comp_leave_balance()` read;
 * every write is a transition function.
 */

/** The free days and the use-by date, for the caller or (the Owner) for a member. */
export async function getCompBalance(memberId?: string): Promise<CompBalance> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc(
    "comp_leave_balance",
    memberId ? { member_id: memberId } : {},
  );
  if (error) throw error;
  const row = data[0];
  return { availableDays: Number(row?.available_days ?? 0), useBy: row?.use_by ?? null };
}

const CREDIT_COLUMNS =
  "id, days, used_days, reserved_days, granted_on, expires_on, note, note_id, revoked_at, revoke_reason";

/** One member's credits, newest grant first: the history under the balance. */
export async function listCredits(memberId: string): Promise<CompCredit[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("comp_leave_credits")
    .select(CREDIT_COLUMNS)
    .eq("member_id", memberId)
    .order("granted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(60);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    days: Number(row.days),
    usedDays: Number(row.used_days),
    reservedDays: Number(row.reserved_days),
    grantedOn: row.granted_on,
    expiresOn: row.expires_on,
    note: row.note,
    noteId: row.note_id,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
  }));
}

export async function rpcGrant(
  memberId: string,
  days: number,
  note: string | null,
): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("comp_leave_grant", {
    member_id: memberId,
    days,
    ...(note ? { note } : {}),
  });
  if (error) throw error;
  return data;
}

export async function rpcRevoke(creditId: string, reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  await withDeadlockRetry(async () => {
    const { error } = await supabase.rpc("comp_leave_revoke", { credit_id: creditId, reason });
    if (error) throw error;
  });
}
