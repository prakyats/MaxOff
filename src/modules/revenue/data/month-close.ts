import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";

import { type MonthCloseRead, toMonthCloseRead } from "../domain/month-close";

/**
 * The month close (v3.5; WORKFLOWS §7.4, DATA-MODEL §9): the Owner's close, correction and the
 * one read. Owner only: `month_close` and `month_correct` need `months.close`, the read needs
 * `finance.view`, and each refuses everyone else in the database. A page starts the read only
 * after its own permission check, so an Admin's request never sends it. The close and the
 * correction are wrapped by `actions/month-close.ts` (U4).
 */

/**
 * The close screen's and a closed month's one read: can it be closed and why not, the waiting
 * list (not closed), the latest snapshot, every version's header and "Changed since close".
 * `month` is any date of the month (`YYYY-MM-DD`). `cache()`d per request.
 */
export const readMonthClose = cache(async (month: string): Promise<MonthCloseRead> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("month_close_read", { month });
  if (error) throw error;
  return toMonthCloseRead(data);
});

/**
 * The Revenue page's month header (v3.5 U4): is this month closed, since when, at which version.
 * Only the versions' numbers and dates, never `data` (no amount, no note): a light read of the
 * snapshot table under its own `finance.view` policy, so the Revenue page never pays for
 * `month_close_read`'s live rebuild. The page starts it only after its permission check, and only
 * for an ended month. `month` is the month's first day. `cache()`d per request.
 */
export const readMonthVersions = cache(
  async (month: string): Promise<{ version: number; closedAt: string }[]> => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("month_snapshots")
      .select("version, closed_at")
      .eq("month", month)
      .order("version");
    if (error) throw error;
    return data.map((row) => ({ version: row.version, closedAt: row.closed_at }));
  },
);

/** Closes an ended month: its snapshot's version 1. Returns the version (1). */
export async function rpcCloseMonth(month: string): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("month_close", { month });
  if (error) throw error;
  return data;
}

/**
 * Corrects a closed month: a full rebuild stored as the next version, with the note. Refused
 * "Nothing changed." when the rebuild equals the latest version. Returns the new version.
 */
export async function rpcCorrectMonth(month: string, note: string): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("month_correct", { month, note });
  if (error) throw error;
  return data;
}
