import "server-only";

import { withDeadlockRetry } from "@/core/db/retry";
import { createServerSupabase } from "@/core/db/server";

import { type PendingLeave, sortPendingLeave } from "../domain/review";
import {
  LEAVE_SOURCES,
  type LeaveSource,
  type LeaveState,
  type LeaveType,
} from "../domain/requests";

/**
 * The Owner's leave reads and decisions (task 2.4). Reads go through RLS
 * (`attendance.view_all`); decisions are `leave_decide`, `leave_owner_edit` and
 * `leave_owner_cancel`, which check `attendance.decide` and take the person's lock first.
 */

const PENDING_LIMIT = 200;

const PENDING_COLUMNS =
  "id, member_id, type, start_date, end_date, reason, source, requests_cancellation, created_at, member:members!member_id(full_name), original:leave_requests!supersedes_id(type, start_date, end_date, state)";

function toSource(value: string): LeaveSource {
  if ((LEAVE_SOURCES as readonly string[]).includes(value)) return value as LeaveSource;
  throw new Error(`Unknown leave source: ${value}`);
}

/**
 * Every request waiting for the Owner, oldest first. Gate requests (`source = attendance`) are
 * left out: they are decided with their day, in the Attendance group (WORKFLOWS §2).
 */
export async function listPendingRequests(): Promise<PendingLeave[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("leave_requests")
    .select(PENDING_COLUMNS)
    .eq("state", "submitted")
    .neq("source", "attendance")
    .order("created_at", { ascending: true })
    .limit(PENDING_LIMIT);
  if (error) throw error;
  return sortPendingLeave(
    data.map((row): PendingLeave => {
      // A self-embed on the row's own foreign key: one object or null (see data/leave.ts).
      const embedded = row.original as unknown;
      const original = (Array.isArray(embedded) ? (embedded[0] ?? null) : embedded) as {
        type: LeaveType;
        start_date: string;
        end_date: string;
        state: LeaveState;
      } | null;
      return {
        id: row.id,
        memberId: row.member_id,
        memberName: row.member?.full_name ?? "Someone",
        type: row.type,
        startDate: row.start_date,
        endDate: row.end_date,
        reason: row.reason,
        source: toSource(row.source),
        requestsCancellation: row.requests_cancellation,
        createdAt: row.created_at,
        original: original
          ? {
              type: original.type,
              startDate: original.start_date,
              endDate: original.end_date,
              state: original.state,
            }
          : null,
      };
    }),
  );
}

/** How many requests wait for the Owner: part of the Approvals badge. */
export async function countPendingRequests(): Promise<number> {
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from("leave_requests")
    .select("id", { count: "exact", head: true })
    .eq("state", "submitted")
    .neq("source", "attendance");
  if (error) throw error;
  return count ?? 0;
}

/** Approve (returns the dates whose earlier Owner decision was kept) or reject with a reason. */
export async function rpcDecide(
  requestId: string,
  decision: "approve" | "reject",
  reason: string | null,
): Promise<string[]> {
  const supabase = await createServerSupabase();
  return withDeadlockRetry(async () => {
    const { data, error } = await supabase.rpc("leave_decide", {
      request_id: requestId,
      decision,
      ...(reason ? { reason } : {}),
    });
    if (error) throw error;
    return data[0]?.kept_dates ?? [];
  });
}

export async function rpcApprove(requestId: string): Promise<string[]> {
  return rpcDecide(requestId, "approve", null);
}

export async function rpcOwnerEdit(input: {
  requestId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
}): Promise<string[]> {
  const supabase = await createServerSupabase();
  return withDeadlockRetry(async () => {
    const { data, error } = await supabase.rpc("leave_owner_edit", {
      request_id: input.requestId,
      type: input.type,
      start_date: input.startDate,
      end_date: input.endDate,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    if (error) throw error;
    return data[0]?.kept_dates ?? [];
  });
}

export async function rpcOwnerCancel(requestId: string, reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  await withDeadlockRetry(async () => {
    const { error } = await supabase.rpc("leave_owner_cancel", { request_id: requestId, reason });
    if (error) throw error;
  });
}
