import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";
import { displayName } from "@/core/lib/display-name";
import { addISTDays, todayIST } from "@/core/time";

import { type LateNoNetwork, planOnLeave, type StayPlan } from "../domain/stay-plans";

/**
 * v7.0 (WORKFLOWS §1 "Stay until ahead of time" and "Clear Late"; DATA-MODEL "v7.0 Stay until ahead
 * and Clear Late"): the reads and the transition functions the database half built. Each function
 * checks its own permission, takes the person's lock, audits and notifies (ADR-0006).
 */

/** What a person's page needs for "Stay until, coming up": the plans and the end time. */
export type PersonStayPlans = {
  plans: StayPlan[];
  /** `org_settings.work_end_time` (`HH:MM`): "Back to 6:00 pm" and the sheet's first time. */
  workEnd: string;
};

/**
 * A person's Stay until set ahead and still waiting for its day (today on, live, not applied),
 * soonest first, each marked when an approved leave covers its date ("Not used: on leave"). The
 * Owner's (RLS: `attendance.decide`); three reads side by side, after the page's first wave.
 */
export async function listStayPlans(memberId: string): Promise<PersonStayPlans> {
  const today = todayIST();
  const supabase = await createServerSupabase();
  const [plans, leaves, settings] = await Promise.all([
    supabase
      .from("attendance_stay_plans")
      .select("id, work_date, until")
      .eq("member_id", memberId)
      .is("cleared_at", null)
      .is("applied_day_id", null)
      .gte("work_date", today)
      .order("work_date", { ascending: true })
      .limit(60),
    supabase
      .from("leave_requests")
      .select("start_date, end_date, half")
      .eq("member_id", memberId)
      .eq("state", "approved")
      .gte("end_date", today),
    supabase.from("org_settings").select("work_end_time").maybeSingle(),
  ]);
  if (plans.error) throw plans.error;
  if (leaves.error) throw leaves.error;
  if (settings.error) throw settings.error;
  const approved = leaves.data.map((leave) => ({
    startDate: leave.start_date,
    endDate: leave.end_date,
    half: leave.half,
  }));
  return {
    plans: plans.data.map((plan) => ({
      id: plan.id,
      workDate: plan.work_date,
      until: plan.until,
      onLeave: planOnLeave(plan.work_date, approved),
    })),
    workEnd: (settings.data?.work_end_time ?? "18:00").slice(0, 5),
  };
}

/**
 * The caller's own Stay until set ahead for today, before the day starts (RLS: their own rows),
 * with the first name of who set it when their directory holds them. Once per request.
 */
export const getOwnStayPlanToday = cache(
  async (memberId: string): Promise<{ until: string; setBy: string | null } | null> => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("attendance_stay_plans")
      .select("until, set_by")
      .eq("member_id", memberId)
      .eq("work_date", todayIST())
      .is("cleared_at", null)
      .is("applied_day_id", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { data: setter } = await supabase
      .from("member_directory")
      .select("full_name")
      .eq("id", data.set_by)
      .maybeSingle();
    return { until: data.until, setBy: setter?.full_name ?? null };
  },
);

/** The Owner sets (or changes) a person's Stay until on a date (`attendance_stay_plan_set`). */
export async function rpcStayPlanSet(
  memberId: string,
  workDate: string,
  until: string,
): Promise<string | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("attendance_stay_plan_set", {
    member_id: memberId,
    work_date: workDate,
    until,
  });
  if (error) throw error;
  return data;
}

/** "Back to 6:00 pm": the plan is cleared, kept (`attendance_stay_plan_clear`). */
export async function rpcStayPlanClear(planId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("attendance_stay_plan_clear", { plan_id: planId });
  if (error) throw error;
}

/** How far back "Late, no network" looks: a month of days. */
const LATE_WINDOW_DAYS = 31;

const LATE_COLUMNS =
  "id, member_id, work_date, started_at, late_minutes, offline_tried_at, member:members!attendance_days_member_id_fkey(full_name, avatar_file_id)";

/**
 * "Late, no network" (Approvals, the Owner's): the last month's Late days the phone tried to start
 * with no network and the Owner has not cleared, oldest first. RLS: `attendance.view_all`.
 */
export async function listLateNoNetwork(): Promise<LateNoNetwork[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("attendance_days")
    .select(LATE_COLUMNS)
    .not("late_minutes", "is", null)
    .not("offline_tried_at", "is", null)
    .not("started_at", "is", null)
    .is("late_cleared_at", null)
    .gte("work_date", addISTDays(todayIST(), -LATE_WINDOW_DAYS))
    .order("work_date", { ascending: true })
    .order("started_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  return data.flatMap((row) =>
    row.late_minutes !== null && row.offline_tried_at && row.started_at
      ? [
          {
            dayId: row.id,
            memberId: row.member_id,
            memberName: displayName(row.member?.full_name),
            memberAvatarFileId: row.member?.avatar_file_id ?? null,
            workDate: row.work_date,
            startedAt: row.started_at,
            lateMinutes: row.late_minutes,
            triedAt: row.offline_tried_at,
          },
        ]
      : [],
  );
}

/** The Owner's Clear Late, or its Undo (`attendance_clear_late`); no notification. */
export async function rpcClearLate(dayId: string, undo: boolean): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("attendance_clear_late", { day_id: dayId, undo });
  if (error) throw error;
}

/** The person's note: today's Late start was first tried at this phone time with no network. */
export async function rpcNoteOfflineTry(triedAt: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("attendance_note_offline_try", { tried_at: triedAt });
  if (error) throw error;
}
