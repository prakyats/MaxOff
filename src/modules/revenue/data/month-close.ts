import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";

import type { SnapshotRevenue } from "../domain/closed-month";
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
 * An ended month on the Revenue page (v3.5 U4, U5): is it closed, since when, at which version,
 * and the **latest version's revenue section**, which a closed month's page draws instead of the
 * live figures (v3.5 Q12). One light select of the snapshot table under its own `finance.view`
 * policy: the versions' numbers and dates, and only `data->schema` and `data->revenue` (never the
 * expense totals, the month summary or the note), so the page never pays for `month_close_read`'s
 * live rebuild. A correction is rare, so every version's revenue section comes in the one request
 * and only the latest is kept. The page starts it only after its permission check, and only for an
 * ended month. `month` is the month's first day. `cache()`d per request.
 */
export const readMonthSnapshots = cache(
  async (
    month: string,
  ): Promise<{
    versions: { version: number; closedAt: string }[];
    latest: SnapshotRevenue | null;
  }> => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("month_snapshots")
      .select("version, closed_at, schema:data->schema, revenue:data->revenue")
      .eq("month", month)
      .order("version");
    if (error) throw error;
    const last = data.at(-1);
    return {
      versions: data.map((row) => ({ version: row.version, closedAt: row.closed_at })),
      latest: last ? { schema: last.schema, revenue: last.revenue } : null,
    };
  },
);

/**
 * Which months are closed (v3.5 U5), for the money sheets' "September is closed. Its report
 * changes only when you correct it." (decision 10). Only the months of the first versions: no
 * version number beyond that, no date, never `data`. Owner only (the table's `finance.view`
 * policy); the project page starts it beside its Billing read, after its own check. `cache()`d.
 */
export const readClosedMonths = cache(async (): Promise<string[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("month_snapshots")
    .select("month")
    .eq("version", 1)
    .order("month");
  if (error) throw error;
  return data.map((row) => row.month);
});

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
