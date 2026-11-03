import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";
import { displayName } from "@/core/lib/display-name";

import type {
  EarlyLeaveRequest,
  EarlyLeaveState,
  Half,
  HoursToday,
  MonthHours,
  OwnHours,
} from "../domain/hours";

/**
 * Working hours (v1.9 W4; WORKFLOWS §1 "Working hours, late starts and leaving early"): the reads
 * and the transition functions W0 built (ADR-0006: each checks its own permission, takes the
 * person's lock and audits). Reads that return `table (…)` columns may be null where the generated
 * types say otherwise (a left join, no request): every column is read as nullable.
 */

type Nullable<T> = { [K in keyof T]: T[K] | null };

const SOURCES = new Set(["work", "shoot", "stay"]);
const source = (value: string | null): "work" | "shoot" | "stay" =>
  value && SOURCES.has(value) ? (value as "work" | "shoot" | "stay") : "work";
const half = (value: string | null): Half | null =>
  value === "morning" || value === "afternoon" ? value : null;

/** The caller's own hours today (`attendance_own_hours()`), once per request. */
export const getOwnHours = cache(async (): Promise<OwnHours | null> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("attendance_own_hours");
  if (error) throw error;
  const row = data[0] as Nullable<(typeof data)[number]> | undefined;
  if (!row || !row.work_date || !row.start_at || !row.late_after || !row.end_at) return null;
  return {
    workDate: row.work_date,
    rulesOn: Boolean(row.rules_on),
    lateApplies: Boolean(row.late_applies),
    earlyApplies: Boolean(row.early_applies),
    half: half(row.half),
    startAt: row.start_at,
    lateAfter: row.late_after,
    endAt: row.end_at,
    endSource: source(row.end_source),
    stayUntil: row.stay_until,
    lateMinutes: row.late_minutes,
    lateReason: row.late_reason,
    lateReasonSuggestion: row.late_reason_suggestion,
    earlyLeave:
      row.early_leave_id && row.early_leave_state && row.early_leave_requested_at
        ? {
            id: row.early_leave_id,
            state: row.early_leave_state as EarlyLeaveState,
            reason: row.early_leave_reason ?? "",
            requestedAt: row.early_leave_requested_at,
            endFrom: row.early_leave_end_from,
          }
        : null,
    canEndNow: Boolean(row.can_end_now),
  };
});

/**
 * How long an unanswered ask waits (`org_settings.early_leave_wait_minutes`), said in the ask sheet
 * ("If there's no answer in 30 minutes"); every member reads their organisation's settings (RLS
 * `org_settings_select`). Not part of `getOwnHours`: the strip starts it only while it offers Ask
 * to leave early, after the page's own reads, and hands the sheet the promise, so it never takes a
 * place in the first wave (v1.9 speed gate, ARCHITECTURE §19). Unread, the sentence is left out.
 */
export const getEarlyLeaveWait = cache(async (): Promise<number | null> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("org_settings")
    .select("early_leave_wait_minutes")
    .maybeSingle();
  if (error) throw error;
  return data?.early_leave_wait_minutes ?? null;
});

/** The person's one-line reason for today's late start (`attendance_late_reason`). */
export async function rpcLateReason(reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("attendance_late_reason", { reason });
  if (error) throw error;
}

/** "Ask to leave early" with a reason (`attendance_ask_leave_early`); the Owner is told. */
export async function rpcAskLeaveEarly(reason: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("attendance_ask_leave_early", { reason });
  if (error) throw error;
  return data;
}

/** The Owner's answer (`early_leave_decide`): approve, stay, or correct a day left unanswered. */
export async function rpcDecideEarlyLeave(input: {
  requestId: string;
  decision: "approve" | "stay" | "correct";
  status: string | null;
  reason: string | null;
}): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("early_leave_decide", {
    request_id: input.requestId,
    decision: input.decision,
    ...(input.status ? { status: input.status as "present" } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  });
  if (error) throw error;
  return data;
}

/** The Owner's "Stay until" for a person today, or null to clear it (`attendance_stay_until`). */
export async function rpcStayUntil(memberId: string, until: string | null): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("attendance_stay_until", {
    member_id: memberId,
    // A null clears it; the generated type does not say the argument is nullable.
    until: until as string,
  });
  if (error) throw error;
  return data;
}

/** Everyone's working hours today, for the Owner (`attendance_hours_today()`), once per request. */
export const getHoursToday = cache(async (): Promise<HoursToday[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("attendance_hours_today");
  if (error) throw error;
  return (data as Nullable<(typeof data)[number]>[]).flatMap((row) =>
    row.member_id && row.end_at
      ? [
          {
            memberId: row.member_id,
            rulesOn: Boolean(row.rules_on),
            startedAt: row.started_at,
            endedAt: row.ended_at,
            lateMinutes: row.late_minutes,
            lateReason: row.late_reason,
            endAt: row.end_at,
            endSource: source(row.end_source),
            stayUntil: row.stay_until,
            earlyLeaveState: (row.early_leave_state as EarlyLeaveState | null) ?? null,
            leftEarly: Boolean(row.left_early),
            endedAfterEnd: Boolean(row.ended_after_end),
          },
        ]
      : [],
  );
});

const EARLY_COLUMNS =
  "id, member_id, day_id, state, reason, requested_at, left_at, member:members!early_leave_requests_member_id_fkey(full_name, avatar_file_id), day:attendance_days!day_id(work_date)";

/**
 * The early-leave requests the Owner decides (Approvals): waiting, and "Left early, not answered",
 * oldest first. RLS: the Owner reads them through `attendance.view_all` (a member reads only their
 * own, and never sees this group).
 */
export async function listEarlyLeaveRequests(): Promise<EarlyLeaveRequest[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("early_leave_requests")
    .select(EARLY_COLUMNS)
    .in("state", ["waiting", "left_unanswered"])
    .order("requested_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return data.flatMap((row) =>
    row.state === "waiting" || row.state === "left_unanswered"
      ? [
          {
            id: row.id,
            memberId: row.member_id,
            memberName: displayName(row.member?.full_name),
            memberAvatarFileId: row.member?.avatar_file_id ?? null,
            workDate: row.day?.work_date ?? "",
            state: row.state,
            reason: row.reason,
            requestedAt: row.requested_at,
            leftAt: row.left_at,
            dayId: row.day_id,
          },
        ]
      : [],
  );
}

/** The month counts per person (`month_summary_hours`), the Owner only, by member id. */
export async function getMonthHours(
  month: string,
  memberId?: string,
): Promise<Record<string, MonthHours>> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("month_summary_hours", {
    month: `${month}-01`,
    ...(memberId ? { member_id: memberId } : {}),
  });
  if (error) throw error;
  return Object.fromEntries(
    data.map((row) => [
      row.id,
      {
        lateDays: Number(row.late_days ?? 0),
        lateMinutes: Number(row.late_minutes ?? 0),
        leftUnanswered: Number(row.left_unanswered ?? 0),
        earlyLeavesApproved: Number(row.early_leaves_approved ?? 0),
        halfDaysMorning: Number(row.half_days_morning ?? 0),
        halfDaysAfternoon: Number(row.half_days_afternoon ?? 0),
      },
    ]),
  );
}
