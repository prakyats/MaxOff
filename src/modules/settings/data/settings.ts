import "server-only";

import type { TablesUpdate } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { AppError } from "@/core/errors";
import type { ISODate } from "@/core/time";

import { type Company, type Holiday, type OrgSettings, toOrgSettings } from "../domain/settings";

/**
 * The settings repository: every database call of the module (CLAUDE.md rule 3). Everything
 * runs under RLS as the signed-in member, so `settings.manage` is the real gate; the actions
 * check it first only to fail friendly.
 */

/** The single organization (DATA-MODEL §1: the org seam). */
export async function getCompany(): Promise<Company & { id: string }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, timezone")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("NOT_FOUND", "No company record was found.");
  return { id: data.id, name: data.name, timezone: data.timezone };
}

export async function updateCompany(id: string, patch: { name: string }): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("organizations")
    .update({ name: patch.name }, { count: "exact" })
    .eq("id", id);
  if (error) throw error;
  if (count === 0) throw new AppError("FORBIDDEN", "Only the Owner changes the company profile.");
}

export async function getSettings(): Promise<OrgSettings & { orgId: string }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("org_settings").select("*").limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("NOT_FOUND", "No settings record was found.");
  return { orgId: data.org_id, ...toOrgSettings(data) };
}

/**
 * A write that RLS refuses simply matches no rows, so an Admin who reaches the action would
 * otherwise be told "saved". `count` turns that into a plain refusal.
 */
async function updateSettings(orgId: string, patch: TablesUpdate<"org_settings">): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("org_settings")
    .update(patch, { count: "exact" })
    .eq("org_id", orgId);
  if (error) throw error;
  if (count === 0) throw new AppError("FORBIDDEN", "Only the Owner changes these settings.");
}

export async function updateWeeklyOffDays(orgId: string, days: number[]): Promise<void> {
  await updateSettings(orgId, { weekly_off_days: days });
}

export async function updateThresholds(
  orgId: string,
  patch: {
    logoutReminderTime: string;
    ackRepeatHours: number;
    ackEscalateHours: number;
    ackEscalateOwnerHours: number;
    overdueEscalateHours: number;
    emailDailyCapPerMember: number;
  },
): Promise<void> {
  await updateSettings(orgId, {
    logout_reminder_time: patch.logoutReminderTime,
    ack_repeat_hours: patch.ackRepeatHours,
    ack_escalate_hours: patch.ackEscalateHours,
    ack_escalate_owner_hours: patch.ackEscalateOwnerHours,
    overdue_escalate_hours: patch.overdueEscalateHours,
    email_daily_cap_per_member: patch.emailDailyCapPerMember,
  });
}

/** Every active member may read the holidays: they are everyone's calendar (PRODUCT §4.8). */
export async function listHolidays(): Promise<Holiday[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("holidays")
    .select("id, date, name")
    .order("date", { ascending: true });
  if (error) throw error;
  return data.map((row) => ({ id: row.id, date: row.date as ISODate, name: row.name }));
}

export async function createHoliday(input: { date: string; name: string }): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("holidays").insert({ date: input.date, name: input.name });
  if (error) throw error;
}

/**
 * Holidays have no `archived_at` (DATA-MODEL §1): removing a mistyped date is a real delete,
 * Owner-only, and `audit_row_change()` keeps the removed row. It never rewrites the past —
 * an attendance day carries its own `is_day_off`, decided on the day itself (2.1).
 */
export async function deleteHoliday(id: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase.from("holidays").delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  if (count === 0) throw new AppError("NOT_FOUND", "That holiday is already gone.");
}
