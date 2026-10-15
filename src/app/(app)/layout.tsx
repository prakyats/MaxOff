import { unstable_rethrow } from "next/navigation";
import { type ReactNode, Suspense } from "react";

import { LogoutProvider } from "@/core/auth/components/logout-confirm";
import { getRealtimeAuth, requireMember } from "@/core/auth/server";
import { getSessionBundle, type SessionBundle } from "@/core/auth/session-bundle";
import { startEarly } from "@/core/lib/start-early";
import { captureException } from "@/core/observability/capture";
import { SentryUser } from "@/core/observability/sentry-user";
import { LiveUpdatesLazy } from "@/core/notifications/components/live-lazy";
import { PushBanner, PushSync } from "@/core/notifications/components/push-lazy";
import { readPushEnv } from "@/core/notifications/env";
import type { ServerUnread } from "@/core/notifications/read-receipts";
import { can } from "@/core/permissions";
import { RouteTransition } from "@/core/ui/motion/route-transition";
import { Toaster } from "@/core/ui/primitives/sonner";
import { AppShell } from "@/core/ui/shell/app-shell";
import { RefreshOnReturn } from "@/core/ui/shell/refresh-on-return";
import type { NavBadges } from "@/core/ui/shell/nav";
import { countsOrNone } from "@/core/ui/shell/nav-counts";
import { getOwnToday, promptDue } from "@/modules/attendance";
import { StartDayPromptLazy } from "@/modules/attendance/components/start-day-prompt-lazy";

/**
 * The viewer's nav counts, server-rendered numbers (no JavaScript of their own), all from the one
 * `session_bundle()` read (P2, ARCHITECTURE §19). **Tasks** (4.5, Kickoff 4 decision 16): the open
 * tasks the viewer, or a freelancer they coordinate, has not noted, plus those with changes
 * requested (`task_counts()`). **Approvals** (2.4): the attendance days, leave requests, extra
 * work notes (3b.2) and expense claims (3b.3, `expenses.decide`) waiting for whoever decides them
 * (the Owner), plus the tasks at the step the viewer decides (4.5: the Owner's final approvals, an
 * Admin's checks); client items take no approval step since amendment D3 (done is the approval).
 * **Alerts** (5.1, kickoff 5 decision 4): the viewer's unread notifications, on every role's bell.
 * The role picks which counts are added up, exactly as each was read before the bundle.
 */
function navBadges(role: Parameters<typeof can>[0], bundle: SessionBundle): NavBadges {
  const tasks = can(role, "tasks.work") ? bundle.tasks : null;
  const alerts = bundle.unread.count;
  if (!can(role, "attendance.decide")) {
    return { tasks: tasks?.badge ?? 0, approvals: tasks?.toDecide ?? 0, alerts };
  }
  const { days, requests, notes, claims } = bundle.pending;
  const claimsToDecide = can(role, "expenses.decide") ? (claims ?? 0) : 0;
  return {
    tasks: tasks?.badge ?? 0,
    approvals:
      (days ?? 0) + (requests ?? 0) + (notes ?? 0) + claimsToDecide + (tasks?.toDecide ?? 0),
    alerts,
  };
}

/**
 * Whether the Start-day prompt is mounted for this request (PRODUCT §4.2, 3b.1): an Admin or
 * Staff member on a working day whose attendance has begun, with no Start day and no leave
 * chosen. Reading, never writing: the day exists only once they start it or choose leave. The
 * prompt itself decides when to open (at most every 30 minutes). The Owner has no day.
 */
async function startDayPrompt(viewer: Awaited<ReturnType<typeof requireMember>>) {
  if (!can(viewer.role, "attendance.self")) return null;
  const today = await getOwnToday();
  return promptDue(today) ? (
    <StartDayPromptLazy memberId={viewer.id} workDate={today.workDate} />
  ) : null;
}

/**
 * The notifications band (kickoff 5 decision 9; since 5.5 until a device of theirs has received a
 * push, and whenever they are not reachable) and this device's check against the member's own
 * active endpoints (`PushSync`), from the bundle's push status. Streamed like the counts (P2): the
 * band is a fixed row above the bottom bar, so arriving a moment after the shell moves nothing,
 * and the shell never waits for it. No status (the bundle failed, reported once): no band.
 */
async function ShellPush({
  push,
  publicKey,
}: {
  push: Promise<SessionBundle["push"] | null>;
  publicKey: string | null;
}) {
  const status = await push;
  if (!status) return null;
  return (
    <>
      <PushSync publicKey={publicKey} endpoints={status.endpoints} />
      {/* A band above the bottom bar (5A decision 30), never at the top of a screen. */}
      {status.band ? <PushBanner publicKey={publicKey} reason={status.band} /> : null}
    </>
  );
}

/**
 * The signed-in area. `requireMember()` is the auth decision (ADR-0011 rule 3): signed out →
 * /login, a session whose member is not active → ended, then /login. Since 3b.1 the app then
 * opens freely (the 2.2 blocking day gate is gone, ADR-0012 amendment 2026-09-27): the Start-day
 * prompt asks in the app, and "Sign out of this device" lives under Me only.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // One wave (§19, P2 2026-10-15): the member row, the shell's bundle (every nav count, the unread
  // count and the push status in one `session_bundle()` call) and the Start-day prompt's read all
  // start together, each keyed by the verified JWT under RLS. Measured before: the unread count,
  // the Owner's four counts and a second push read waited behind the member row.
  const bundle = getSessionBundle();
  startEarly(getOwnToday(), bundle);
  const viewer = await requireMember();
  // The counts, the bell and the band stream (`NavCount`, 4C): the shell and the page never wait
  // for them, so a screen's loading state paints as soon as the member is known. A bundle that
  // cannot be read is reported (once, by `countsOrNone`) and shows as no count and no band, never
  // the error screen (4C review S3); Next's own signals still go through.
  const report = (error: unknown) => {
    unstable_rethrow(error);
    captureException(error);
  };
  const badges = countsOrNone(
    bundle.then((read) => navBadges(viewer.role, read)),
    report,
  );
  const unread: Promise<ServerUnread | null> = bundle.then(
    (read) => read.unread,
    () => null,
  );
  const push = bundle.then(
    (read) => read.push,
    () => null,
  );
  const prompt = await startDayPrompt(viewer);
  // The public key is read at runtime and handed to the browser (decision 26); null = push off.
  const pushEnv = readPushEnv();
  const publicKey = pushEnv.mode === "on" ? pushEnv.publicKey : null;
  // The live bell's token (5.1): the session just verified, read from its cookie (no round trip).
  const live = await getRealtimeAuth();

  return (
    // The sign-out confirmation lives above the shell, so the edit pattern's unsaved-changes
    // warning (2.9) reaches it from any screen.
    <LogoutProvider hasWorkingDay={can(viewer.role, "attendance.self")}>
      <AppShell viewer={viewer} badges={badges} unread={unread}>
        <SentryUser id={viewer.id} />
        <RefreshOnReturn />
        {prompt}
        <Suspense fallback={null}>
          <ShellPush push={push} publicKey={publicKey} />
        </Suspense>
        {live ? (
          <LiveUpdatesLazy memberId={viewer.id} token={live.token} expiresIn={live.expiresIn} />
        ) : null}
        <RouteTransition>{children}</RouteTransition>
      </AppShell>
      {/* Here rather than in the root layout: sonner is only ever used by signed-in screens, and
          mounting it globally shipped it to /login (task 1.5). No tooltip provider: no screen
          draws a tooltip, and the unused provider cost every screen ~10 KB (6.0). */}
      <Toaster position="top-center" closeButton />
    </LogoutProvider>
  );
}
