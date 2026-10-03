import "server-only";

import { createServerSupabase } from "@/core/db/server";

import { type AppReport, type ReachabilityRow, toReachabilityRows } from "./reachability";

/**
 * Reachability's reads and the app's report (task 5.4; DATA-MODEL §9 `member_reachability`,
 * `member_app_reports`). Neither table is the API's: both go through security definer functions
 * that apply PERMISSIONS `notifications.reachability` and never return an endpoint.
 */

/**
 * Settings → Notifications (`reachability_overview()`): the Owner gets every tracked member with
 * since, platform and last success; an Admin the people on their open tasks, state alone; anyone
 * else is refused by the database (FORBIDDEN).
 */
export async function readReachability(): Promise<ReachabilityRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("reachability_overview");
  if (error) throw error;
  return toReachabilityRows(data ?? []);
}

/** The app's report when it opens (`app_open_report`): the caller's own row, a change only. */
export async function rpcAppOpenReport(report: AppReport): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("app_open_report", {
    platform: report.platform,
    is_standalone: report.isStandalone,
  });
  if (error) throw error;
}
