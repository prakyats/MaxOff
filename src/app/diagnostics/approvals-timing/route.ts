import { notFound } from "next/navigation";

import { getSessionState, withSessionUserId } from "@/core/auth/server";
import { getSessionBundle } from "@/core/auth/session-bundle";
import { readOwnPushStatus } from "@/core/notifications/push/subscriptions";
import { whenWaiting } from "@/core/lib/when-waiting";
import { can } from "@/core/permissions";
import {
  getOwnToday,
  listEarlyLeaveRequests,
  listPendingDays,
  listPendingNotes,
} from "@/modules/attendance";
import { listPendingClaims } from "@/modules/expenses";
import { listPendingRequests } from "@/modules/leave";
import { listTasksAtBothSteps, listUnreadCounts } from "@/modules/tasks";
import { listDirectory } from "@/modules/team";

// Evaluated per request, never at build time (see /diagnostics/sentry).
export const dynamic = "force-dynamic";

/** The numbers the route answers: each read's answer time from the wave's start, in ms. */
export type ApprovalsTiming = {
  member: number;
  push: number;
  bundle: number;
  today: number;
  days: number;
  requests: number;
  notes: number;
  claims: number;
  directory: number;
  early: number;
  tasks: number;
  unread: number;
  /** When the layout's awaited reads were all in: the first byte cannot come sooner. */
  shell: number;
  /** When the page's own reads were all in, the unread counts included. */
  page: number;
};

/**
 * Where the Approvals screen's time goes on the Worker (v1.9 speed gate, advisor #89 comment
 * 6605368404; ARCHITECTURE §19 "Six connections"): the `(app)` layout's reads and the Approvals
 * page's first wave, started in the order a real request starts them (the layout's member row,
 * own day, push status and counts, then the page's lists and its task steps, then the unread
 * counts the task rows wait for), each timed from the wave's start to its answer. A read that
 * queued behind the Worker's six open connections shows as a later answer. Observation only, like
 * `/diagnostics/timing`: members only (anyone else 404s), nothing written, in no nav, and the
 * answer is milliseconds only, never data (no row, id, name or text). Kept while the gate needs
 * it; a later cleanup unit removes it (PROGRESS).
 */
export async function GET(): Promise<Response> {
  const waveStart = performance.now();
  const since = () => Math.round(performance.now() - waveStart);
  const timed = <T>(read: Promise<T>) => read.then((value) => ({ value, ms: since() }));
  const quiet = <T>(read: Promise<T>) => timed(read.catch(() => null));

  // The layout's wave, in its order (`src/app/(app)/layout.tsx`).
  const member = timed(getSessionState());
  const today = quiet(getOwnToday());
  const push = quiet(readOwnPushStatus());
  const counts = getSessionBundle();
  const bundle = quiet(counts);
  // The page's reads, as it starts them (`src/app/(app)/approvals/page.tsx`, v2.0 X3): both task
  // steps in one read and the directory first, then the pending days (v2.0 X4: with the first
  // wave again); each of the other lists only once the counts say one is waiting (counts that
  // could not be read ask the usual way).
  const steps = withSessionUserId(listTasksAtBothSteps);
  const directory = quiet(listDirectory());
  const days = quiet(listPendingDays());
  const requests = quiet(
    whenWaiting(counts, (bundleRead) => bundleRead.pending.requests, listPendingRequests),
  );
  const notes = quiet(
    whenWaiting(counts, (bundleRead) => bundleRead.pending.notes, listPendingNotes),
  );
  const claims = quiet(
    whenWaiting(counts, (bundleRead) => bundleRead.pending.claims, listPendingClaims),
  );
  const early = quiet(
    whenWaiting(counts, (bundleRead) => bundleRead.pending.earlyLeaves, listEarlyLeaveRequests),
  );
  const both = timed(steps.catch(() => ({ final: [], check: [] })));

  const state = await member;
  if (state.value.kind !== "member") notFound();
  const role = state.value.member.role;
  // As the page: the role picks the step once the member is known, then its rows' unread counts.
  const stepsRead = await both;
  const tasks = {
    ms: stepsRead.ms,
    value: can(role, "tasks.approve_final") ? stepsRead.value.final : stepsRead.value.check,
  };
  const unread = await quiet(listUnreadCounts(tasks.value.map((item) => item.row.id)));
  const [pushRead, bundleRead, todayRead, ...lists] = await Promise.all([
    push,
    bundle,
    today,
    days,
    requests,
    notes,
    claims,
    directory,
    early,
  ]);
  const [daysRead, requestsRead, notesRead, claimsRead, directoryRead, earlyRead] = lists;
  // The layout awaits the member row, the push status and (for a working role) the own day.
  const ownDay = can(role, "attendance.self") ? todayRead.ms : 0;

  const body: ApprovalsTiming = {
    member: state.ms,
    push: pushRead.ms,
    bundle: bundleRead.ms,
    today: ownDay,
    days: daysRead.ms,
    requests: requestsRead.ms,
    notes: notesRead.ms,
    claims: claimsRead.ms,
    directory: directoryRead.ms,
    early: earlyRead.ms,
    tasks: tasks.ms,
    unread: unread.ms,
    shell: Math.max(state.ms, pushRead.ms, ownDay),
    page: Math.max(...lists.map((read) => read.ms), tasks.ms, unread.ms),
  };
  return Response.json(body, {
    headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
}
