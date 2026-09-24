import "server-only";

import { createServerSupabase } from "@/core/db/server";

import type { AttendanceChoice } from "../domain/choices";
import { eventActor, type HistoryDay, isEventAction } from "../domain/history";
import { type Month, monthRange } from "../domain/months";
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

const HISTORY_COLUMNS =
  "id, work_date, state, submitted_choice, final_status, is_day_off, worked_on_leave, first_login_at, last_logout_at, logout_not_recorded, overtime_flag, overtime_reason, events:attendance_events(id, action, from_status, to_status, reason, actor_id, at)";

/**
 * The member's own days in one IST month, newest first, each with its events in the order
 * they happened (`id`: one transaction shares one `now()`, so `at` cannot order them). A
 * month is at most 31 rows, which is the page.
 */
export async function listOwnDays(memberId: string, month: Month): Promise<HistoryDay[]> {
  const { first, last } = monthRange(month);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("attendance_days")
    .select(HISTORY_COLUMNS)
    .eq("member_id", memberId)
    .gte("work_date", first)
    .lte("work_date", last)
    .order("work_date", { ascending: false })
    .order("id", { referencedTable: "attendance_events", ascending: true });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    workDate: row.work_date,
    state: row.state,
    submittedChoice: row.submitted_choice,
    finalStatus: row.final_status,
    isDayOff: row.is_day_off,
    workedOnLeave: row.worked_on_leave,
    firstLoginAt: row.first_login_at,
    lastLogoutAt: row.last_logout_at,
    logoutNotRecorded: row.logout_not_recorded,
    overtimeFlag: row.overtime_flag,
    overtimeReason: row.overtime_reason,
    events: row.events.flatMap((event) =>
      isEventAction(event.action)
        ? [
            {
              id: event.id,
              action: event.action,
              fromStatus: event.from_status,
              toStatus: event.to_status,
              reason: event.reason,
              actor: eventActor(event.actor_id, memberId),
              at: event.at,
            },
          ]
        : [],
    ),
  }));
}
