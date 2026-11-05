import { notFound } from "next/navigation";

import { firstReadsStats, getSessionState } from "@/core/auth/server";
import { getSessionBundle } from "@/core/auth/session-bundle";
import { readOwnPushStatus } from "@/core/notifications/push/subscriptions";
import { can } from "@/core/permissions";
import { getEarlyLeaveWait, getOwnHours, getOwnToday } from "@/modules/attendance";

// Evaluated per request, never at build time (see /diagnostics/sentry).
export const dynamic = "force-dynamic";

/**
 * Where the attendance strip's screens spend their time on the Worker (v2.0 X2 follow-up, the
 * advisor's India probe on #89: Admin /today and Crew /my-day slower, only roles with an own day,
 * only on the screen that shows it). The `(app)` layout's reads in its order (the member row, the
 * own day and the push status, then the counts), then the strip's (the own day again, `cache()`d,
 * and the own hours), then End day's early-leave wait as the strip starts it after them, each
 * timed from the start; and this request's first-read hold counters (`firstReadsStats`: how many
 * waits, how many the 50 ms valve ended, the longest). Observation only, like
 * `/diagnostics/timing`: members only (anyone else 404s), nothing written, in no nav, the answer
 * milliseconds and counts only, never data. Kept while the gate needs it; a later cleanup removes
 * it (PROGRESS).
 */
export async function GET(): Promise<Response> {
  const start = performance.now();
  const since = () => Math.round(performance.now() - start);
  const timed = <T>(read: Promise<T>) => read.then((value) => ({ value, ms: since() }));
  const quiet = <T>(read: Promise<T>) => timed(read.catch(() => null));

  // The layout's order (`src/app/(app)/layout.tsx`).
  const member = timed(getSessionState());
  const today = quiet(getOwnToday());
  const push = quiet(readOwnPushStatus());
  const bundle = quiet(getSessionBundle());
  // The strip's (`/my-day` and the Admin's `/today` start them with their first wave).
  const hours = quiet(getOwnHours());

  const state = await member;
  if (state.value.kind !== "member") notFound();
  const role = state.value.member.role;
  const [todayRead, pushRead, bundleRead, hoursRead] = await Promise.all([
    today,
    push,
    bundle,
    hours,
  ]);
  // The strip starts End day's wait after the page's reads (`AskLeaveEarlyButton`).
  const wait = await quiet(getEarlyLeaveWait());
  const own = can(role, "attendance.self");

  const body = {
    member: state.ms,
    today: own ? todayRead.ms : 0,
    push: pushRead.ms,
    bundle: bundleRead.ms,
    hours: own ? hoursRead.ms : 0,
    early_wait: wait.ms,
    shell: Math.max(state.ms, pushRead.ms, own ? todayRead.ms : 0),
    strip: own ? Math.max(todayRead.ms, hoursRead.ms) : 0,
    total: since(),
    first_reads: firstReadsStats(),
    role,
  };
  return Response.json(body, {
    headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
}
