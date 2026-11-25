import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";
import type { ISODate } from "@/core/time";

import type { ClientWorkFacts, DelayFact, PersonFacts, StageFact } from "../domain/owner-reports";

/**
 * The Owner's reports' reads (v3.0, 9.3): one database function each, counted in the database and
 * refused to anyone without `reports.all` (security invoker: every row policy still decides).
 * Read only; never money (invariant 2). `cache()`d per request, so a section and its neighbour
 * share one read.
 */

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The people report's task facts per person (`report_people`). */
export const listPeopleFacts = cache(async (from: ISODate, to: ISODate): Promise<PersonFacts[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("report_people", { p_from: from, p_to: to });
  if (error) throw error;
  return data.map((row) => ({
    memberId: row.member_id,
    completed: num(row.completed) ?? 0,
    onTime: num(row.on_time) ?? 0,
    ownedCompleted: num(row.owned_completed) ?? 0,
    revisionLoops: num(row.revision_loops) ?? 0,
    handInHours: num(row.hand_in_hours),
    ackLagHours: num(row.ack_lag_hours),
    openNow: num(row.open_now) ?? 0,
    overdueNow: num(row.overdue_now) ?? 0,
  }));
});

/** The tasks due in the period that were late or still are (`report_task_delays`). */
export const listDelays = cache(async (from: ISODate, to: ISODate): Promise<DelayFact[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("report_task_delays", { p_from: from, p_to: to });
  if (error) throw error;
  return data.map((row) => ({
    taskId: row.task_id,
    title: row.title,
    primaryOwnerId: row.primary_owner_id,
    typeName: row.type_name ?? null,
    clientName: row.client_name ?? null,
    dueAt: row.due_at,
    handedInAt: row.handed_in_at ?? null,
    open: row.open,
    lateReason: row.late_reason ?? null,
  }));
});

/** The stage durations by name, overall and per project (`report_stage_durations`). */
export const listStageDurations = cache(
  async (from: ISODate, to: ISODate): Promise<StageFact[]> => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("report_stage_durations", {
      p_from: from,
      p_to: to,
    });
    if (error) throw error;
    return data.map((row) => ({
      projectId: row.project_id ?? null,
      projectName: row.project_name ?? null,
      clientName: row.client_name ?? null,
      stageKey: row.stage_key,
      stageName: row.stage_name,
      ticks: num(row.ticks) ?? 0,
      medianDays: num(row.median_days) ?? 0,
      longestDays: num(row.longest_days) ?? 0,
    }));
  },
);

/** Each client's deliverables for the period (`report_client_work`): counts, never money. */
export const listClientWork = cache(
  async (from: ISODate, to: ISODate): Promise<ClientWorkFacts[]> => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("report_client_work", { p_from: from, p_to: to });
    if (error) throw error;
    return data.map((row) => ({
      clientId: row.client_id,
      clientName: row.client_name,
      planned: num(row.planned) ?? 0,
      done: num(row.done) ?? 0,
      doneOnTime: num(row.done_on_time) ?? 0,
      doneInPeriod: num(row.done_in_period) ?? 0,
      overdueNow: num(row.overdue_now) ?? 0,
      onHold: num(row.on_hold) ?? 0,
      projectsCompleted: num(row.projects_completed) ?? 0,
    }));
  },
);
