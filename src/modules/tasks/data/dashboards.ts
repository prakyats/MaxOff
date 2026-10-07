import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { addISTDays, istDayStart, type ISODate } from "@/core/time";

import type { EventTask, KpiFacts } from "../domain/dashboards";

/**
 * The task reads behind the dashboards (6A: My Day, Today, the Admin's work report). Under RLS as
 * the signed-in member, like every task read: `app.task_visible()` decides what exists.
 */

/**
 * The event tasks (an event date, kickoff 4) on the IST days `from` to `to`, cancelled ones left
 * out, with their people: My Day's events and Today's events strip (Kickoff 6 decisions 2, 12).
 */
export async function listEventTasks(from: ISODate, to: ISODate): Promise<EventTask[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, state, event_date, event_start_at, location, primary_owner_id, task_assignees(member_id, removed_at)",
    )
    .gte("event_date", from)
    .lte("event_date", to)
    .neq("state", "cancelled")
    .order("event_date", { ascending: true })
    .order("event_start_at", { ascending: true, nullsFirst: true });
  if (error) throw error;
  return data.flatMap((row) =>
    row.event_date
      ? [
          {
            id: row.id,
            title: row.title,
            state: row.state,
            eventDate: row.event_date as ISODate,
            eventStartAt: row.event_start_at,
            location: row.location,
            primaryOwnerId: row.primary_owner_id,
            assigneeIds: row.task_assignees
              .filter((a) => a.removed_at === null)
              .map((a) => a.member_id),
          },
        ]
      : [],
  );
}

/**
 * The facts the Admin's work report counts (6.3, PRODUCT §4.13), for the IST days `from` to `to`
 * inclusive: every hand-in (a submission version), every review, and every "Task Noted" in the
 * range, on the tasks the viewer sees. Small: a team's month of work.
 */
export async function listKpiFacts(from: ISODate, to: ISODate): Promise<KpiFacts> {
  const supabase = await createServerSupabase();
  const start = istDayStart(from).toISOString();
  const end = istDayStart(addISTDays(to, 1)).toISOString();
  const [submissions, reviews, notes] = await Promise.all([
    supabase
      .from("task_submissions")
      .select("id, task_id, at, tasks!inner(primary_owner_id)")
      .gte("at", start)
      .lt("at", end),
    supabase
      .from("task_reviews")
      .select(
        "id, task_id, step, decision, reviewer_id, submission_id, at, tasks!inner(primary_owner_id)",
      )
      .gte("at", start)
      .lt("at", end),
    supabase
      .from("task_assignees")
      .select("task_id, member_id, assigned_at, acknowledged_at")
      .gte("acknowledged_at", start)
      .lt("acknowledged_at", end),
  ]);
  if (submissions.error) throw submissions.error;
  if (reviews.error) throw reviews.error;
  if (notes.error) throw notes.error;
  // A submission's or review's own submission, for the turnaround (Done → this approval).
  const submissionIds = reviews.data.flatMap((r) => (r.submission_id ? [r.submission_id] : []));
  const handIns = new Map(submissions.data.map((s) => [s.id, s.at]));
  const missing = submissionIds.filter((id) => !handIns.has(id));
  if (missing.length > 0) {
    const earlier = await supabase.from("task_submissions").select("id, at").in("id", missing);
    if (earlier.error) throw earlier.error;
    for (const row of earlier.data) handIns.set(row.id, row.at);
  }
  return {
    submissions: submissions.data.map((s) => ({
      taskId: s.task_id,
      at: s.at,
      primaryOwnerId: s.tasks.primary_owner_id,
    })),
    reviews: reviews.data.map((r) => ({
      taskId: r.task_id,
      step: r.step as "admin" | "owner",
      decision: r.decision,
      reviewerId: r.reviewer_id,
      at: r.at,
      handedInAt: r.submission_id ? (handIns.get(r.submission_id) ?? null) : null,
      primaryOwnerId: r.tasks.primary_owner_id,
    })),
    notes: notes.data.flatMap((n) =>
      n.acknowledged_at
        ? [
            {
              taskId: n.task_id,
              memberId: n.member_id,
              assignedAt: n.assigned_at,
              acknowledgedAt: n.acknowledged_at,
            },
          ]
        : [],
    ),
  };
}
