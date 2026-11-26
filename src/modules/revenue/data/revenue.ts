import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";

import { type RevenueMonth, toRevenueMonth } from "../domain/revenue";

/**
 * The Revenue page's month in one read (9.2; DATA-MODEL §7, WORKFLOWS §6): the retainer cycles
 * and one-time projects of one IST month, the advances received and returned in it, and the
 * months that hold anything. The function refuses anyone without `finance.view` (the Owner alone
 * holds it); the page starts this only after its own permission check, so an Admin's request
 * never sends it. `month` is the month's first day, or null for this IST month (the database's
 * `app.today_ist()` decides which). `cache()`d per request.
 */
export const readRevenueMonth = cache(async (month: string | null): Promise<RevenueMonth> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("revenue_month_read", month ? { month } : {});
  if (error) throw error;
  return toRevenueMonth(data);
});
