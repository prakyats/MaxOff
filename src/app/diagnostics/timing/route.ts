import { notFound } from "next/navigation";

import { getCurrentMember, getSessionUserId } from "@/core/auth/server";
import { readUnread } from "@/core/notifications/inbox";
import { readOwnPushStatus } from "@/core/notifications/push/subscriptions";
import { isolateState } from "@/core/observability/isolate";
import { getOwnToday } from "@/modules/attendance";
import { countTasks } from "@/modules/tasks";

// Evaluated per request, never at build time (see /diagnostics/sentry).
export const dynamic = "force-dynamic";

/**
 * Where a signed-in request's server time goes (unit P, 2026-10-15; ARCHITECTURE §19): the
 * `(app)` layout's own chain, run here one step after the other and timed on the Worker itself,
 * so a probe (`scripts/perf-probe.mjs`, `.github/workflows/perf.yml`) can read each round trip's
 * cost from where the Worker runs. Members only: anyone else, signed out included, 404s like the
 * other diagnostics. Nothing is written; the answer is milliseconds and the isolate's state,
 * never data (no row, no id, no name). `cache-control: no-store`.
 */
export async function GET(): Promise<Response> {
  const started = performance.now();
  let last = started;
  const lap = () => {
    const now = performance.now();
    const ms = Math.round(now - last);
    last = now;
    return ms;
  };

  const userId = await getSessionUserId();
  const claims = lap();
  if (!userId) notFound();
  const member = await getCurrentMember();
  const memberRow = lap();
  if (!member) notFound();

  await getOwnToday();
  const today = lap();
  await countTasks();
  const taskCounts = lap();
  await readUnread();
  const unread = lap();
  await readOwnPushStatus();
  const push = lap();

  const isolate = isolateState();
  const body = {
    claims,
    member: memberRow,
    today,
    task_counts: taskCounts,
    unread,
    push,
    total: Math.round(performance.now() - started),
    isolate_n: isolate.n,
    isolate_age: isolate.age,
    role: member.role,
  };
  return Response.json(body, {
    headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
}
