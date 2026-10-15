import { notFound } from "next/navigation";

import { getSessionState, getSessionUserId } from "@/core/auth/server";
import { getSessionBundle } from "@/core/auth/session-bundle";
import { isolateState } from "@/core/observability/isolate";
import { can } from "@/core/permissions";
import { getOwnToday } from "@/modules/attendance";

// Evaluated per request, never at build time (see /diagnostics/sentry).
export const dynamic = "force-dynamic";

/**
 * Where a signed-in request's server time goes (unit P, 2026-10-15; ARCHITECTURE §19): the
 * `(app)` layout's own chain, run here the way the layout runs it and timed on the Worker itself,
 * so a probe (`scripts/perf-probe.mjs`, `.github/workflows/perf.yml`) can read each round trip's
 * cost from where the Worker runs. Since P2 (2026-10-15) the chain is the JWT check, then one wave:
 * the member row, the shell's bundle (`session_bundle()`: every nav count, the unread count, the
 * push status) and the Start-day prompt's own day, all started together. Each part is timed from
 * the wave's start to its answer; `wave` is the whole wave (the slowest part, so one hop when the
 * reads run in parallel), `total` everything. Members only: anyone else, signed out included,
 * 404s like the other diagnostics. Nothing is written; the answer is milliseconds and the
 * isolate's state, never data (no row, no id, no name). `cache-control: no-store`.
 */
export async function GET(): Promise<Response> {
  const started = performance.now();
  const userId = await getSessionUserId();
  const claims = Math.round(performance.now() - started);
  if (!userId) notFound();

  const waveStart = performance.now();
  const timed = <T>(read: Promise<T>) =>
    read.then((value) => ({ value, ms: Math.round(performance.now() - waveStart) }));
  // The layout starts the day for everyone (the role is not known yet) and uses it for all but the
  // Owner, who has no working day (§8): timed the same way.
  const [member, bundle, today] = await Promise.all([
    timed(getSessionState()),
    timed(getSessionBundle()),
    timed(getOwnToday().catch(() => null)),
  ]);
  const wave = Math.round(performance.now() - waveStart);
  if (member.value.kind !== "member") notFound();
  const role = member.value.member.role;

  const isolate = isolateState();
  const body = {
    claims,
    member: member.ms,
    bundle: bundle.ms,
    today: can(role, "attendance.self") ? today.ms : 0,
    wave,
    total: Math.round(performance.now() - started),
    isolate_n: isolate.n,
    isolate_age: isolate.age,
    role,
  };
  return Response.json(body, {
    headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
}
