import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";

import { type MonthTotals, toMonthTotals } from "../domain/today";

/**
 * The Owner's Today line in one read (v2.5, kickoff 9 R5; DATA-MODEL §7): this IST month's
 * Potential, Achieved, Remaining and the not-priced and no-amount counts. The function refuses
 * anyone without `finance.view` (the Owner alone holds it); Today starts this only once the role
 * is known, so an Admin's Today never sends it. `cache()`d per request.
 */
export const readMonthTotals = cache(async (): Promise<MonthTotals> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("revenue_month_totals");
  if (error) throw error;
  return toMonthTotals(data);
});
