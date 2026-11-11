import { notFound } from "next/navigation";

import {
  firstReadsStats,
  getSessionState,
  requireMember,
  shellStartedAt,
  withSessionUserId,
} from "@/core/auth/server";
import { getSessionBundle } from "@/core/auth/session-bundle";
import { checkThenRead } from "@/core/lib/start-early";
import { listOwnPushSubscriptions } from "@/core/notifications/push/subscriptions";
import { getOwnMember, listDirectoryOf, listOwnFreelancers } from "@/modules/team";

/**
 * Where Me's first byte spends its time on the Worker (v2.0 X4, the advisor on #89 6785208528: the
 * US probe had the Owner's /me, /approvals, /clients, a project and a person one Worker→DB trip
 * slower than v1.9, which neither `next start` nor a local `wrangler dev` reproduces). The numbers
 * behind `/diagnostics/me-timing`, rendered **inside the `(app)` layout**, so the shell runs around
 * it exactly as on /me; it makes /me's own reads in /me's order (`checkThenRead(requireMember(),
 * …)`, then the directory for the freelancers the member coordinates), each timed from this page's
 * start, plus the shell's reads as the page sees them (`cache()`d: the layout's own) and this
 * request's first-read hold counters (`firstReadsStats`). Observation only: **the Owner's only**
 * (anyone else 404s; the layout signs out anyone who isn't a member), nothing written, in no nav,
 * milliseconds and counts only, never data. Removed before READY with batch 1's diagnostics cleanup
 * (the advisor, #89 6785394395).
 */
export async function measureMe() {
  const start = performance.now();
  // When the page began, after the layout's first line (`startShellRead`), and on the Worker's
  // clock, which counts from the request's start (Node's counts from the process's).
  const shellAt = shellStartedAt();
  const pageAfterShell = shellAt === null ? -1 : Math.round(start - shellAt);
  const since = () => Math.round(performance.now() - start);
  const timed = <T>(read: Promise<T>) => read.then((value) => ({ value, ms: since() }));

  const shell = timed(getSessionState());
  const bundle = timed(getSessionBundle().catch(() => null));
  const [viewer, [own, spells, subscriptions]] = await checkThenRead(
    timed(requireMember()),
    Promise.all([
      timed(withSessionUserId(getOwnMember)),
      timed(listOwnFreelancers()),
      timed(listOwnPushSubscriptions()),
    ]),
  );
  // The Owner's only (the advisor, #89 6785394395): anyone else gets the not-found screen.
  if (viewer.value.role !== "owner") notFound();
  const current = spells.value.filter((spell) => spell.toAt === null);
  const directory =
    current.length > 0
      ? await timed(listDirectoryOf(current.map((row) => row.memberId)))
      : { ms: 0 };
  const [shellRead, bundleRead] = await Promise.all([shell, bundle]);

  const body = {
    page_after_layout: pageAfterShell,
    page_at: Math.round(start),
    shell: shellRead.ms,
    bundle: bundleRead.ms,
    member: viewer.ms,
    own: own.ms,
    freelancers: spells.ms,
    devices: subscriptions.ms,
    directory: directory.ms,
    freelancer_count: current.length,
    device_count: subscriptions.value.length,
    total: since(),
    first_reads: firstReadsStats(),
    role: viewer.value.role,
  };
  return body;
}
