import type { ReactNode } from "react";

import {
  IssueDayPass,
  LogoutMenuItem,
  LogoutProvider,
  LogoutSheetItem,
} from "@/core/auth/components";
import { requireDayGate } from "@/core/auth/gate";
import { requireMember } from "@/core/auth/server";
import { SentryUser } from "@/core/observability/sentry-user";
import { can } from "@/core/permissions";
import { Toaster } from "@/core/ui/primitives/sonner";
import { TooltipProvider } from "@/core/ui/primitives/tooltip";
import { AppShell } from "@/core/ui/shell/app-shell";
import { OvertimeLogoutNote } from "@/modules/attendance";

/**
 * The signed-in area. `requireMember()` is the auth decision (ADR-0011 rule 3): signed out →
 * /login, a session whose member is not active → ended, then /login. Then the day gate
 * (ARCHITECTURE §8, task 2.2): an Admin or Staff member who has not settled today goes to the
 * choice screen first; the Owner is never gated.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireMember();
  const gate = await requireDayGate(viewer);

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
        >
          <SentryUser id={viewer.id} />
          {gate === "issue-pass" ? <IssueDayPass /> : null}
          {children}
        </AppShell>
      </TooltipProvider>
      <Toaster position="top-center" closeButton />
    </LogoutProvider>
  );
}
