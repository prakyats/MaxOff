import {
  firstReadsStats,
  getSessionState,
  requireMember,
  withSessionUserId,
} from "@/core/auth/server";
import { getSessionBundle } from "@/core/auth/session-bundle";
import { checkThenRead } from "@/core/lib/start-early";
import { listOwnPushSubscriptions } from "@/core/notifications/push/subscriptions";
import { getOwnMember, listDirectoryOf, listOwnFreelancers } from "@/modules/team";

/**
 * Where Me's first byte spends its time on the Worker (v2.0 X4, the advisor on #89 6785208528:
 * the US probe had the Owner's /me, /approvals, /clients, a project and a person one Worker→DB
 * trip slower than v1.9, which neither `next start` nor a local `wrangler dev` reproduces).
 * The numbers behind `/diagnostics/me-timing`, rendered **inside the `(app)` layout**, so the
 * shell runs around it exactly as on /me; it makes /me's own reads in /me's order (`checkThenRead(requireMember(), …)`, then the directory for the
 * freelancers the member coordinates), each timed from this page's start, plus the shell's reads
 * as the page sees them (`cache()`d: the layout's own) and this request's first-read hold
 * counters (`firstReadsStats`). Observation only: members only (the layout signs anyone else
 * out), nothing written, in no nav, milliseconds and counts only, never data. Kept while X4 needs
 * it; a later cleanup removes it (PROGRESS).
 */
export async function measureMe() {
  const start = performance.now();
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
  const current = spells.value.filter((spell) => spell.toAt === null);
  const directory =
    current.length > 0
      ? await timed(listDirectoryOf(current.map((row) => row.memberId)))
      : { ms: 0 };
  const [shellRead, bundleRead] = await Promise.all([shell, bundle]);

  const body = {
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
