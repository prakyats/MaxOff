"use client";

import { useEffect } from "react";

import { forgetShellViewer } from "./shell-viewer";

/**
 * Mounted by the signed-out screens' layout: arriving there drops the instant skeleton's cache
 * (ADR-0014 item 4), however the visitor got there. The worker drops it itself on a full
 * navigation to a signed-out page; an expired session's redirect to sign-in is the router's, a
 * soft one it never sees. Renders nothing.
 */
export function ForgetShellViewer(): null {
  useEffect(() => {
    forgetShellViewer();
  }, []);
  return null;
}
