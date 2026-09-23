import type { ReactNode } from "react";

import { LogoutMenuItem } from "@/core/auth/components";
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
    <AppShell viewer={viewer} logoutItem={<LogoutMenuItem />}>
      <SentryUser id={viewer.id} />
      {children}
    </AppShell>
  );
}
