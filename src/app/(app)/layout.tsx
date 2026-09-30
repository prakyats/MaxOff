import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";

import { LogoutProvider } from "@/core/auth/components/logout-confirm";
import { requireMember } from "@/core/auth/server";
import { startEarly } from "@/core/lib/start-early";
import { captureException } from "@/core/observability/capture";
import { SentryUser } from "@/core/observability/sentry-user";
import { PushBanner, PushSync } from "@/core/notifications/components/push-lazy";
import { readPushEnv } from "@/core/notifications/env";
import { listOwnActiveEndpoints } from "@/core/notifications/push/subscriptions";
import { can } from "@/core/permissions";
import { RouteTransition } from "@/core/ui/motion/route-transition";
import { Toaster } from "@/core/ui/primitives/sonner";
import { TooltipProvider } from "@/core/ui/primitives/tooltip";
import { AppShell } from "@/core/ui/shell/app-shell";
import { RefreshOnReturn } from "@/core/ui/shell/refresh-on-return";
import type { NavBadges } from "@/core/ui/shell/nav";
import { countsOrNone } from "@/core/ui/shell/nav-counts";
import { countPendingDays, countPendingNotes, getOwnToday, promptDue } from "@/modules/attendance";
import { StartDayPrompt } from "@/modules/attendance/components/start-day-prompt";
import { countPendingRequests } from "@/modules/leave";
import { countPendingClaims } from "@/modules/expenses";
import { countTasks } from "@/modules/tasks";

/**
 * The viewer's nav counts, server-rendered numbers (no JavaScript of their own). **Tasks** (4.5,
 * Kickoff 4 decision 16): the open tasks the viewer, or a freelancer they coordinate, has not
 * noted, plus those with changes requested (`task_counts()`). **Approvals** (2.4): the attendance
 * days, leave requests, extra work notes (3b.2) and expense claims (3b.3, `expenses.decide`)
 * waiting for whoever decides them (the Owner), plus the tasks at the step the viewer decides
 * (4.5: the Owner's final approvals, an Admin's checks); client items join in 7.4.
 */
async function navBadges(role: Parameters<typeof can>[0]): Promise<NavBadges> {
  const tasks = can(role, "tasks.work") ? countTasks() : Promise.resolve(null);
  if (!can(role, "attendance.decide")) {
    const counts = await tasks;
    return { tasks: counts?.badge ?? 0, approvals: counts?.toDecide ?? 0 };
  }
  const [counts, days, requests, notes, claims] = await Promise.all([
    tasks,
    countPendingDays(),
    countPendingRequests(),
    countPendingNotes(),
    can(role, "expenses.decide") ? countPendingClaims() : Promise.resolve(0),
  ]);
  return {
    tasks: counts?.badge ?? 0,
    approvals: days + requests + notes + claims + (counts?.toDecide ?? 0),
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
    <StartDayPrompt memberId={viewer.id} workDate={today.workDate} />
  ) : null;
}

/**
 * The signed-in area. `requireMember()` is the auth decision (ADR-0011 rule 3): signed out →
 * /login, a session whose member is not active → ended, then /login. Since 3b.1 the app then
 * opens freely (the 2.2 blocking day gate is gone, ADR-0012 amendment 2026-09-27): the Start-day
 * prompt asks in the app, and "Sign out of this device" lives under Me only.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // The prompt's read (everyone but the Owner has a day) and the task counts (every role's badge)
  // start with the session read (§19).
  startEarly(getOwnToday(), countTasks());
  const viewer = await requireMember();
  // The counts stream into the bars (`NavCount`, 4C): the shell and the page never wait for them,
  // so a screen's loading state paints as soon as the member is known. A count that cannot be
  // read is reported and shows as none, never the error screen (4C review S3); Next's own
  // signals still go through.
  const badges = countsOrNone(navBadges(viewer.role), (error) => {
    unstable_rethrow(error);
    captureException(error);
  });
  const prompt = await startDayPrompt(viewer);
  // The enable-notifications banner is judged per member (kickoff 5 decision 9): the member's
  // own active endpoints decide it, and tell this device whether it is one of them (PushSync).
  // The public key is read at runtime and handed to the browser (decision 26); null = push off.
  const push = readPushEnv();
  const endpoints = await listOwnActiveEndpoints();
  const publicKey = push.mode === "on" ? push.publicKey : null;

  return (
    // The sign-out confirmation lives above the shell, so the edit pattern's unsaved-changes
    // warning (2.9) reaches it from any screen.
    <LogoutProvider hasWorkingDay={can(viewer.role, "attendance.self")}>
      {/* Here rather than in the root layout: sonner and radix-tooltip are only ever used by
          signed-in screens, and mounting them globally shipped both to /login (task 1.5). */}
      <TooltipProvider>
        <AppShell viewer={viewer} badges={badges}>
          <SentryUser id={viewer.id} />
          <RefreshOnReturn />
          {prompt}
          <PushSync publicKey={publicKey} endpoints={endpoints} />
          <RouteTransition>
            {endpoints.length === 0 ? <PushBanner publicKey={publicKey} /> : null}
            {children}
          </RouteTransition>
        </AppShell>
      </TooltipProvider>
      <Toaster position="top-center" closeButton />
    </LogoutProvider>
  );
}
