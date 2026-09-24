import "server-only";

import { createServerSupabase } from "@/core/db/server";

import {
  LEAVE_SOURCES,
  type LeaveSource,
  type LeaveType,
  type OwnLeaveRequest,
} from "../domain/requests";

/**
 * The leave repository (CLAUDE.md rule 3). Reads go through RLS as the signed-in member (own
 * rows only, DATA-MODEL §3); every write is a transition function (ADR-0006).
 */

/** Requests per page on the Requests tab: every list is paginated (Supabase free plan). */
export const LEAVE_PAGE_SIZE = 20;

const REQUEST_COLUMNS =
  "id, type, start_date, end_date, reason, state, source, supersedes_id, requests_cancellation, decision_reason, created_at, original:leave_requests!supersedes_id(type, start_date, end_date)";

/**
 * The check constraint allows exactly these three. An unknown one fails loudly: guessing
 * "form" could offer an action the functions refuse for a new source.
 */
function toSource(value: string): LeaveSource {
  if ((LEAVE_SOURCES as readonly string[]).includes(value)) return value as LeaveSource;
  throw new Error(`Unknown leave source: ${value}`);
}

/**
 * One page of the member's own requests, newest first, with the one fact a row cannot see on
 * its own: whether a change or cancellation of it is waiting (it may sit on another page).
 */
export async function listOwnRequests(
  memberId: string,
  page: number,
): Promise<{ requests: OwnLeaveRequest[]; total: number }> {
  const supabase = await createServerSupabase();
  const from = (page - 1) * LEAVE_PAGE_SIZE;
  const [list, open] = await Promise.all([
    supabase
      .from("leave_requests")
      .select(REQUEST_COLUMNS, { count: "exact" })
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + LEAVE_PAGE_SIZE - 1),
    // A member has at most a handful of these open at once.
    supabase
      .from("leave_requests")
      .select("supersedes_id")
      .eq("member_id", memberId)
      .eq("state", "submitted")
      .not("supersedes_id", "is", null),
  ]);
  if (list.error) throw list.error;
  if (open.error) throw open.error;

  const openChanges = new Set(open.data.map((row) => row.supersedes_id));
  const requests = list.data.map((row): OwnLeaveRequest => {
    // The generated types read a self-reference as to-many; `!supersedes_id` is the row's own
    // foreign key, so PostgREST sends one object (or null). Accept either shape.
    const embedded = row.original as unknown;
    const original = (Array.isArray(embedded) ? (embedded[0] ?? null) : embedded) as {
      type: LeaveType;
      start_date: string;
      end_date: string;
    } | null;
    return {
      id: row.id,
      type: row.type,
      startDate: row.start_date,
      endDate: row.end_date,
      reason: row.reason,
      state: row.state,
      source: toSource(row.source),
      supersedesId: row.supersedes_id,
      requestsCancellation: row.requests_cancellation,
      decisionReason: row.decision_reason,
      createdAt: row.created_at,
      original: original
        ? { type: original.type, startDate: original.start_date, endDate: original.end_date }
        : null,
      hasOpenChange: openChanges.has(row.id),
    };
  });
  return { requests, total: list.count ?? requests.length };
}

export async function rpcSubmit(input: {
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
}): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("leave_submit", {
    type: input.type,
    start_date: input.startDate,
    end_date: input.endDate,
    ...(input.reason ? { reason: input.reason } : {}),
  });
  if (error) throw error;
}

export async function rpcWithdraw(requestId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("leave_withdraw", { request_id: requestId });
  if (error) throw error;
}

export async function rpcRequestChange(
  requestId: string,
  change:
    | { cancel: true; reason: string | null }
    | { cancel: false; type: LeaveType; startDate: string; endDate: string; reason: string | null },
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc(
    "leave_request_change",
    change.cancel
      ? { request_id: requestId, cancel: true, ...(change.reason ? { reason: change.reason } : {}) }
      : {
          request_id: requestId,
          type: change.type,
          start_date: change.startDate,
          end_date: change.endDate,
          ...(change.reason ? { reason: change.reason } : {}),
        },
  );
  if (error) throw error;
}
