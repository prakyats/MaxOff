import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";
import { type BandReason, toBandReason } from "@/core/notifications/push/band";
import type { ServerUnread } from "@/core/notifications/read-receipts";
import { systemClock } from "@/core/time";

/**
 * What the signed-in shell draws for the viewer besides who they are, in **one** round trip
 * (`session_bundle()`, P2 2026-10-15, ARCHITECTURE §19): the Tasks badge's counts
 * (`task_counts()`'s), the bell's unread count, the Owner's pending approvals by kind (null for
 * anyone who does not decide them) and the notifications band's push status
 * (`push_status_own()`'s). It replaced up to eight reads in two waves.
 */
export type SessionBundle = {
  tasks: { notNoted: number; changesRequested: number; badge: number; toDecide: number };
  /** The bell's count, with the server's clock taken before it was asked (`read-receipts.ts`). */
  unread: ServerUnread;
  /** Each kind waiting for the Owner; null for a viewer who does not decide it. */
  pending: {
    days: number | null;
    requests: number | null;
    notes: number | null;
    claims: number | null;
  };
  push: { endpoints: string[]; band: BandReason | null };
};

/**
 * The bundle, once per request (`cache()`): the `(app)` layout starts it with the session read,
 * keyed by the verified JWT under RLS (security invoker), so it never waits for the member row;
 * the bars, the bell, the band and the screens that show the same counts (Tasks, an Admin's
 * Today, Alerts) share the one call. Never an authorisation decision: the layout still awaits
 * `requireMember()` before it renders, and a count is only a hint. Not for a background route
 * (`/api/notifications/unread` reads its count alone): every number here is the shell's.
 */
export const getSessionBundle = cache(async (): Promise<SessionBundle> => {
  // Stamped before the count is asked: a read written before this moment is in it.
  const countedAt = systemClock().getTime();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("session_bundle").single();
  if (error) throw error;
  // A function's columns are typed not-null; every one of these may be null (no member row, or
  // a count this viewer does not get).
  const row = data as { [K in keyof typeof data]: (typeof data)[K] | null };
  return {
    tasks: {
      notNoted: row.not_noted ?? 0,
      changesRequested: row.changes_requested ?? 0,
      badge: row.badge ?? 0,
      toDecide: row.to_decide ?? 0,
    },
    unread: { count: row.unread ?? 0, countedAt },
    pending: {
      days: row.pending_days,
      requests: row.pending_requests,
      notes: row.pending_notes,
      claims: row.pending_claims,
    },
    push: { endpoints: row.push_endpoints ?? [], band: toBandReason(row.push_band) },
  };
});
