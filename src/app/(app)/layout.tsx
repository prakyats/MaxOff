import type { ReactNode } from "react";

import { IssueDayPass } from "@/core/auth/components/issue-day-pass";
import { LogoutMenuItem, LogoutSheetItem } from "@/core/auth/components/logout-button";
import { LogoutProvider } from "@/core/auth/components/logout-confirm";
import { requireDayGate } from "@/core/auth/gate";
import { requireMember } from "@/core/auth/server";
import { SentryUser } from "@/core/observability/sentry-user";
import { can } from "@/core/permissions";
import { RouteTransition } from "@/core/ui/motion/route-transition";
import { Toaster } from "@/core/ui/primitives/sonner";
import { TooltipProvider } from "@/core/ui/primitives/tooltip";
import { AppShell } from "@/core/ui/shell/app-shell";
import { RefreshOnReturn } from "@/core/ui/shell/refresh-on-return";
import type { NavBadges } from "@/core/ui/shell/nav";
import { countPendingDays } from "@/modules/attendance";
import { OvertimeLogoutNote } from "@/modules/attendance/components/overtime-logout-note";
import { countPendingRequests } from "@/modules/leave";

/**
 * The viewer's nav counts. Approvals (2.4): the attendance days and leave requests waiting for
 * whoever decides them (`attendance.decide`, the Owner); tasks and client items join in 4.5 and
 * 7.4. Two indexed counts per page load, only for the Owner.
 */
async function navBadges(role: Parameters<typeof can>[0]): Promise<NavBadges> {
  if (!can(role, "attendance.decide")) return {};
  const [days, requests] = await Promise.all([countPendingDays(), countPendingRequests()]);
  return { approvals: days + requests };
}

/**
 * The signed-in area. `requireMember()` is the auth decision (ADR-0011 rule 3): signed out →
 * /login, a session whose member is not active → ended, then /login. Then the day gate
 * (ARCHITECTURE §8, task 2.2): an Admin or Staff member who has not settled today goes to the
 * choice screen first; the Owner is never gated.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireMember();
  const [gate, badges] = await Promise.all([requireDayGate(viewer), navBadges(viewer.role)]);

  return (
    // The Log out confirmation lives above the shell: the account menu and the More sheet both
    // close when you choose an item, and a dialog rendered inside either would close with them.
    // Whoever marks attendance can add an overtime note as they log out (2.3 polish).
    <LogoutProvider
      extra={can(viewer.role, "attendance.self") ? <OvertimeLogoutNote /> : undefined}
    >
      {/* Here rather than in the root layout: sonner and radix-tooltip are only ever used by
          signed-in screens, and mounting them globally shipped both to /login (task 1.5). */}
      <TooltipProvider>
        <AppShell
          viewer={viewer}
          logoutItem={<LogoutMenuItem />}
          logoutSheetItem={<LogoutSheetItem />}
          badges={badges}
        >
          <SentryUser id={viewer.id} />
          <RefreshOnReturn />
          {gate === "issue-pass" ? <IssueDayPass /> : null}
          <RouteTransition>{children}</RouteTransition>
        </AppShell>
      </TooltipProvider>
      <Toaster position="top-center" closeButton />
    </LogoutProvider>
  );
}
