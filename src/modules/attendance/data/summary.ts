import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { displayName } from "@/core/lib/display-name";

import type { MonthSummary } from "../domain/summary";

/**
 * The month summary (DATA-MODEL §7b, 3b.4): `month_summary()` decides who is in it and every
 * figure, and answers FORBIDDEN to anyone but `attendance.view_all` (the Owner). `month` is
 * `yyyy-MM`; the function takes any date of it.
 */
export async function getMonthSummary(month: string, memberId?: string): Promise<MonthSummary[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("month_summary", {
    month: `${month}-01`,
    ...(memberId ? { member_id: memberId } : {}),
  });
  if (error) throw error;
  return data.map((row) => ({
    memberId: row.id,
    fullName: displayName(row.full_name),
    role: row.role,
    workingDays: Number(row.working_days),
    daysWorked: Number(row.days_worked),
    presentDays: Number(row.present_days),
    leaveDays: Number(row.leave_days),
    halfDays: Number(row.half_days),
    absentDays: Number(row.absent_days),
    compLeaveDays: Number(row.comp_leave_days),
    additionalLeave: Number(row.additional_leave),
    daysOffWorked: Number(row.days_off_worked),
    pendingDays: Number(row.pending_days),
    overtimeNotes: Number(row.overtime_notes),
    overtimeGranted: Number(row.overtime_granted),
    creditsGranted: Number(row.credits_granted),
    creditsUsed: Number(row.credits_used),
    creditsExpired: Number(row.credits_expired),
  }));
}
