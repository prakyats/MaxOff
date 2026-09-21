import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/core/ui/shell/app-shell";
import { getPreviewViewer } from "@/core/ui/shell/preview-viewer";

/**
 * The signed-in area. Task 1.2 swaps `getPreviewViewer()` for `core/auth`'s
 * `getCurrentMember()` (redirecting to /login) and task 2.2 adds `requireDayGate()` here
 * (ARCHITECTURE §8). Until then there is nothing to show in production, so it 404s.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await getPreviewViewer();
  if (!viewer) notFound();

  return <AppShell viewer={viewer}>{children}</AppShell>;
}
