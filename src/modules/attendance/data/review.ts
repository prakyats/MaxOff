import "server-only";

import { withDeadlockRetry } from "@/core/db/retry";
import { createServerSupabase } from "@/core/db/server";

import type { DayStatus } from "../domain/choices";
import { type PendingDay, sortPending, type TodayPerson } from "../domain/review";

/**
 * The Owner's attendance reads and decisions (task 2.4). Reads go through RLS
 * (`attendance.view_all`: every member's days); decisions are `attendance_decide()`, which
 * checks `attendance.decide` itself and takes the person's lock first (ADR-0006, DATA-MODEL §3).
 */

/** At most this many waiting days are listed; nobody decides more in one sitting. */
const PENDING_LIMIT = 200;

const PENDING_COLUMNS =
  "id, member_id, work_date, submitted_choice, submitted_at, final_status, proposed_by_system, is_day_off, first_login_at, member:members!member_id(full_name), leave_request:leave_requests!leave_request_id(state), events:attendance_events(id, action, reason)";

/** Every day waiting for the Owner, oldest first (PRODUCT "Approvals"). */
export async function listPendingDays(): Promise<PendingDay[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("attendance_days")
    .select(PENDING_COLUMNS)
    .eq("state", "pending_review")
    .order("work_date", { ascending: true })
    .order("id", { referencedTable: "attendance_events", ascending: true })
    .limit(PENDING_LIMIT);
  if (error) throw error;
  return sortPending(
    data.map((row): PendingDay => {
      const submitted = row.events.filter((event) => event.action === "submitted").at(-1);
      return {
        id: row.id,
        memberId: row.member_id,
        memberName: row.member?.full_name ?? "Someone",
        workDate: row.work_date,
        submittedChoice: row.submitted_choice,
        finalStatus: row.final_status,
        proposedBySystem: row.proposed_by_system,
        onApprovedLeave: row.leave_request?.state === "approved",
        isDayOff: row.is_day_off,
        firstLoginAt: row.first_login_at,
        note: submitted?.reason ?? null,
        submittedAt: row.submitted_at,
      };
    }),
  );
}

/** How many days wait for the Owner: part of the Approvals badge. */
export async function countPendingDays(): Promise<number> {
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from("attendance_days")
    .select("id", { count: "exact", head: true })
    .eq("state", "pending_review");
  if (error) throw error;
  return count ?? 0;
}

type Loose<T> = { [K in keyof T]: T[K] | null };

/**
 * Today for everyone who marks attendance (`attendance_today()`). The generated types read
 * every column as non-null; a person with no day yet has nulls, so the row is read loosely.
 */
export async function getTodayPeople(): Promise<{ people: TodayPerson[]; isDayOff: boolean }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("attendance_today");
  if (error) throw error;
  const people = (data as Loose<(typeof data)[number]>[]).map((row): TodayPerson => ({
    memberId: row.member_id ?? "",
    name: row.full_name ?? "",
    jobTitle: row.job_title,
    started: row.started ?? false,
    dayId: row.day_id,
    state: row.state,
    finalStatus: row.final_status,
    submittedChoice: row.submitted_choice,
    firstLoginAt: row.first_login_at,
    lastLogoutAt: row.last_logout_at,
    logoutNotRecorded: row.logout_not_recorded ?? false,
    overtimeFlag: row.overtime_flag ?? false,
    isDayOff: row.is_day_off ?? false,
    onLeave: row.on_leave ?? false,
    leaveType: row.leave_type,
  }));
  // A day row opened on a working day records false, so any true means today is a day off.
  return { people, isDayOff: people.some((person) => person.isDayOff) };
}

export async function rpcApproveDay(dayId: string): Promise<void> {
  const supabase = await createServerSupabase();
  await withDeadlockRetry(async () => {
    const { error } = await supabase.rpc("attendance_decide", {
      day_id: dayId,
      decision: "approve",
    });
    if (error) throw error;
  });
}

export async function rpcCorrectDay(
  dayId: string,
  status: DayStatus,
  reason: string,
): Promise<void> {
  const supabase = await createServerSupabase();
  await withDeadlockRetry(async () => {
    const { error } = await supabase.rpc("attendance_decide", {
      day_id: dayId,
      decision: "correct",
      status,
      reason,
    });
    if (error) throw error;
  });
}
