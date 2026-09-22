import { redirect } from "next/navigation";

import { homeFor } from "@/core/ui/shell/nav";
import { getPreviewViewer } from "@/core/ui/shell/preview-viewer";

/**
 * Sends a signed-in member to their home. Task 1.2 replaces the preview viewer with the
 * real session and sends everyone else to /login; until then the landing shows below.
 */
export default async function Home() {
  const viewer = await getPreviewViewer();
  if (viewer) redirect(homeFor(viewer.role));

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">MaxOff</h1>
      <p className="text-muted-foreground text-sm">
        Internal operations and control system for Pixora Clips.
      </p>
      <p className="text-muted-foreground/70 text-xs">Phase 0 · foundation</p>
    </main>
  );
}
