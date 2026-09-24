import "server-only";

import { createServerSupabase } from "@/core/db/server";

import type { AttendanceChoice } from "../domain/choices";
import type { TodayDay } from "../domain/today";

/**
 * The attendance repository (CLAUDE.md rule 3). Reads go through RLS as the signed-in member
 * (own rows only); every write is a transition function (ADR-0006). Opening the day is
 * `core/auth` `touchToday()`, because the layout's gate needs it before any module renders.
 */

const TODAY_COLUMNS =
  "id, work_date, state, submitted_choice, final_status, is_day_off, proposed_by_system, decided_by, decision_reason, worked_on_leave, overtime_flag, overtime_reason, leave_request:leave_requests(type)";

/**
 * The member's own day for that IST date, or null (the joining day, or the Owner). `fresh`
 * re-reads after a write in the same render: Next memoizes identical GET fetches for the
 * length of a request, and a request with an abort signal is exempt from that.
 */
export async function getOwnDay(
  memberId: string,
  date: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<TodayDay | null> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("attendance_days")
    .select(TODAY_COLUMNS)
    .eq("member_id", memberId)
    .eq("work_date", date);
  if (fresh) query = query.abortSignal(new AbortController().signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    workDate: data.work_date,
    state: data.state,
    submittedChoice: data.submitted_choice,
    finalStatus: data.final_status,
    isDayOff: data.is_day_off,
    proposedBySystem: data.proposed_by_system,
    decidedBySystem: data.decided_by === null,
    decisionReason: data.decision_reason,
    workedOnLeave: data.worked_on_leave,
    overtimeFlag: data.overtime_flag,
    overtimeReason: data.overtime_reason,
    leaveType: data.leave_request?.type ?? null,
  };
}

export async function rpcSubmit(
  choice: AttendanceChoice,
  reason: string | null,
  forDate: string,
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("attendance_submit", {
    choice,
    for_date: forDate,
    ...(reason ? { reason } : {}),
  });
  if (error) throw error;
}

export async function rpcFlagOvertime(dayId: string, reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("attendance_flag_overtime", { day_id: dayId, reason });
  if (error) throw error;
}
