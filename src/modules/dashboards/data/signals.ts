import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { addISTDays, type ISODate } from "@/core/time";

import type { HeldEmails, LeaveDay } from "../domain/today";

/**
 * The dashboards' reads that the API cannot make from the tables (6A, migration
 * `dashboards_today`, DATA-MODEL §6 "The dashboards' reads"): each a security-definer function
 * that checks its own key and refuses everyone else.
 */

/** The Owner's "not noted past the Owner escalation" (`attendance.view_all`), 5.3's clock. */
export async function listNotNoted(): Promise<
  { taskId: string; memberId: string; since: string }[]
> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("dashboard_not_noted");
  if (error) throw error;
  return data.map((row) => ({
    taskId: row.task_id,
    memberId: row.member_id,
    since: row.waiting_since,
  }));
}

/** Who on open work can't be reached by 5.4's 48-hour status (`notifications.reachability`). */
export async function listUnreachable(): Promise<
  { memberId: string; name: string; state: string; openTasks: number }[]
> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("dashboard_unreachable");
  if (error) throw error;
  return data.map((row) => ({
    memberId: row.member_id,
    name: row.full_name,
    state: row.state,
    openTasks: row.open_tasks,
  }));
}

/** Today's emails the daily limit held back, by limit (`settings.manage`). */
export async function countHeldEmails(): Promise<HeldEmails> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("emails_held_today");
  if (error) throw error;
  const held = (cap: string) => data.find((row) => row.cap === cap)?.held ?? 0;
  return { orgCap: held("org_cap"), memberCap: held("member_cap") };
}

/** The most rows one call may answer (PostgREST's `max_rows` is 1000): a longer read is cut. */
const ROWS_PER_CALL = 900;

/**
 * Approved leave per person per IST day over a range (`member_availability()`, 4A;
 * `availability.view`, at most 62 days), for these people only: the leave risk rows and the
 * Owner's "N on leave". The answer is one row per person per day, so the range is read in slices
 * that each stay under PostgREST's row limit (a cut answer would hide someone's leave).
 */
export async function listLeaveDays(
  from: ISODate,
  to: ISODate,
  memberIds: readonly string[],
): Promise<LeaveDay[]> {
  const people = [...new Set(memberIds)];
  if (people.length === 0 || to < from) return [];
  const supabase = await createServerSupabase();
  const calls: { from: ISODate; to: ISODate; ids: string[] }[] = [];
  for (let first = 0; first < people.length; first += ROWS_PER_CALL) {
    const ids = people.slice(first, first + ROWS_PER_CALL);
    const perCall = Math.max(1, Math.floor(ROWS_PER_CALL / ids.length));
    for (let start = from; start <= to; start = addISTDays(start, perCall)) {
      const end = addISTDays(start, perCall - 1);
      calls.push({ from: start, to: end < to ? end : to, ids });
    }
  }
  const answers = await Promise.all(
    calls.map((call) =>
      supabase.rpc("member_availability", {
        from_date: call.from,
        to_date: call.to,
        member_ids: call.ids,
      }),
    ),
  );
  return answers.flatMap(({ data, error }) => {
    if (error) throw error;
    return data.map((row) => ({ memberId: row.member_id, day: row.day, leave: row.leave }));
  });
}
