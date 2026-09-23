import type { ReactNode } from "react";

import { LogoutMenuItem, LogoutProvider, LogoutSheetItem } from "@/core/auth/components";
import { requireMember } from "@/core/auth/server";
import { SentryUser } from "@/core/observability/sentry-user";
import { AppShell } from "@/core/ui/shell/app-shell";

/**
 * The signed-in area. `requireMember()` is the auth decision (ADR-0011 rule 3): signed out →
 * /login, a session whose member is not active → ended, then /login. Task 2.2 adds
 * `requireDayGate()` here (ARCHITECTURE §8).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireMember();

  return (
    // The Log out confirmation lives above the shell: the account menu and the More sheet both
    // close when you choose an item, and a dialog rendered inside either would close with them.
    <LogoutProvider>
      <AppShell
        viewer={viewer}
        logoutItem={<LogoutMenuItem />}
        logoutSheetItem={<LogoutSheetItem />}
      >
        <SentryUser id={viewer.id} />
        {children}
      </AppShell>
    </LogoutProvider>
  );
}
