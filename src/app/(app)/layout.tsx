import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentMember } from "@/core/auth/server";
import { AppShell } from "@/core/ui/shell/app-shell";

/**
 * The signed-in area. `getCurrentMember()` is the auth seam: task 1.2 makes it read the real
 * session (and this 404 becomes a redirect to /login); task 2.2 adds `requireDayGate()` here
 * (ARCHITECTURE §8). Until then there is nothing to show in production, so it 404s.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await getCurrentMember();
  if (!viewer) notFound();

  return <AppShell viewer={viewer}>{children}</AppShell>;
}
