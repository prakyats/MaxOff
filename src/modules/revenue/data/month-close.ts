import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";

import type { SnapshotRevenue } from "../domain/closed-month";
import { type MonthCloseRead, monthSnapshotsSchema, toMonthCloseRead } from "../domain/month-close";
import { type MonthReminder, monthReminderSchema } from "../domain/month-reminder";

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
 * the **latest version's revenue section**, which a closed month's page draws instead of the live
 * figures (v3.5 Q12), and the organization's **first priced month**, before which the header has
 * no "Close month" (its close screen would say "Nothing to close."). One light call,
 * `month_snapshots_read` (`finance.view`, refused for everyone else): the versions' numbers and
 * dates, only `data->schema` and `data->revenue` of the latest (never the expense totals, the
 * month summary or the note), so the page never pays for `month_close_read`'s live rebuild. The
 * page starts it only after its permission check, and only for an ended month, beside the month's
 * own read. `month` is the month's first day. `cache()`d per request.
 */
export const readMonthSnapshots = cache(
  async (
    month: string,
  ): Promise<{
    versions: { version: number; closedAt: string }[];
    latest: SnapshotRevenue | null;
    firstPricedMonth: string | null;
  }> => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("month_snapshots_read", { month });
    if (error) throw error;
    const read = monthSnapshotsSchema.parse(data);
    return {
      versions: read.versions.map((row) => ({ version: row.version, closedAt: row.closed_at })),
      latest: read.latest ? { schema: read.latest.schema, revenue: read.latest.revenue } : null,
      firstPricedMonth: read.first_priced_month,
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

/**
 * The Reports line's read (v3.5 U6, WORKFLOWS §7.3): the oldest month from the first priced month
 * on that is still not closed, from the 6th of the month after it (IST), and how many more; null
 * when none is due. Months only, never `data` or an amount. Owner only (`finance.view`, refused in
 * the database for everyone else); the Reports page starts it after its own check. `cache()`d.
 */
export const readMonthReminder = cache(async (): Promise<MonthReminder | null> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("month_close_reminder");
  if (error) throw error;
  return monthReminderSchema.parse(data);
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
