import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";

import type { PromptLeaveChoice } from "../domain/choices";
import { eventActor, type HistoryDay, isEventAction } from "../domain/history";
import { type Month, monthRange } from "../domain/months";
import type { OwnToday } from "../domain/today";

/**
 * The attendance repository (CLAUDE.md rule 3). Reads go through RLS as the signed-in member
 * (own rows only) or through the security-definer reads of DATA-MODEL §3; every write is a
 * transition function (ADR-0006).
 */

/**
 * The caller's own day for today, and what today is (`attendance_own_today()`, 3b.1). Once per
 * request (`cache()`): the `(app)` layout asks for the Start-day prompt and the page's strip asks
 * again, and Next renders the two in parallel.
 */
export const getOwnToday = cache(async (): Promise<OwnToday> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("attendance_own_today");
  if (error) throw error;
  // `returns table`: PostgREST hands back a one-row array.
  const row = data[0];
  if (!row) throw new Error("attendance_own_today returned no row");
  return {
    workDate: row.work_date,
    attendanceStarted: row.attendance_started,
    isWorkingDay: row.is_working_day,
    day:
      row.day_id && row.state
        ? {
            id: row.day_id,
            workDate: row.work_date,
            state: row.state,
            submittedChoice: row.submitted_choice,
            finalStatus: row.final_status,
            isDayOff: row.is_day_off,
            proposedBySystem: row.proposed_by_system,
            decidedBySystem: row.decided_by_system,
            decisionReason: row.decision_reason,
            workedOnLeave: row.worked_on_leave,
            overtimeFlag: row.overtime_flag,
            overtimeReason: row.overtime_reason,
            leaveType: row.leave_type,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            endNotRecorded: row.end_not_recorded,
            firstLoginAt: row.first_login_at,
          }
        : null,
    yesterdayOpen:
      row.yesterday_open_day_id && row.yesterday_started_at
        ? { dayId: row.yesterday_open_day_id, startedAt: row.yesterday_started_at }
        : null,
    coveringLeaveType: row.covering_leave_type,
  };
});

/** Start day: the tap is the start (`attendance_start_day()`). Returns the day id. */
export async function rpcStartDay(): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("attendance_start_day");
  if (error) throw error;
  return data;
}

/**
 * End day: today's started day, or yesterday's after midnight (`attendance_end_day()`), with the
 * confirmation's optional overtime note written in the same transaction (3b.2).
 */
export async function rpcEndDay(
  overtimeNote: string | null,
  overtimeMinutes: number | null,
): Promise<{ dayId: string; workDate: string }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("attendance_end_day", {
    ...(overtimeNote ? { overtime_note: overtimeNote } : {}),
    ...(overtimeNote && overtimeMinutes ? { overtime_minutes: overtimeMinutes } : {}),
  });
  if (error) throw error;
  const row = data[0];
  if (!row) throw new Error("attendance_end_day returned no row");
  return { dayId: row.day_id, workDate: row.work_date };
}

/** The prompt's leave choice for today (`attendance_choose_leave_today()`). */
export async function rpcChooseLeaveToday(
  choice: PromptLeaveChoice,
  reason: string | null,
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("attendance_choose_leave_today", {
    choice,
    ...(reason ? { reason } : {}),
  });
  if (error) throw error;
}

/** "I'm working the full day" on a half-day leave day: `attendance_submit(present)` (2.1). */
export async function rpcSubmitPresent(forDate: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("attendance_submit", {
    choice: "present",
    for_date: forDate,
  });
  if (error) throw error;
}

const HISTORY_COLUMNS =
  "id, work_date, state, submitted_choice, final_status, is_day_off, worked_on_leave, first_login_at, last_logout_at, logout_not_recorded, started_at, ended_at, end_not_recorded, overtime_flag, overtime_reason, events:attendance_events(id, action, from_status, to_status, reason, actor_id, at)";

/**
 * One member's days in one IST month, newest first, each with its events in the order they
 * happened (`id`: one transaction shares one `now()`, so `at` cannot order them). A month is at
 * most 31 rows, which is the page. RLS decides whose: the member's own, or anyone's for
 * `attendance.view_all` (the Owner's person history, 2.4). Event actors are relative to the
 * person the days belong to.
 */
export async function listDays(memberId: string, month: Month): Promise<HistoryDay[]> {
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
    startedAt: row.started_at,
    endedAt: row.ended_at,
    endNotRecorded: row.end_not_recorded,
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
