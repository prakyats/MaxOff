"use client";

import { useEffect } from "react";

import { systemClock } from "@/core/time/clock";
import type { ShellRole } from "@/core/ui/shell/viewer";

import { postShellViewer } from "./shell-viewer";
import { sendWarmUp, startWarmUp } from "./warm-up";

/**
 * The signed-in shell's service-worker helpers (P2), in a production build only (`next dev`
 * registers no worker): the instant skeleton's viewer (`shell-viewer.ts`) and the warm-up
 * (`warm-up.ts`). Loaded after the page (`PwaAfterPageLazy`); the page it mounts on was just
 * answered by the server, so the warm-up's throttle starts now. Renders nothing.
 */
export function PwaAfterPage({ role }: { role: ShellRole }): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    postShellViewer(navigator.serviceWorker.controller, role);
  }, [role]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    return startWarmUp(
      { document, window, navigator, now: () => systemClock().getTime(), send: sendWarmUp },
      systemClock().getTime(),
    );
  }, []);
  return null;
}
