import type { ShellRole } from "@/core/ui/shell/viewer";

/**
 * The instant skeleton's viewer (P2, ADR-0014). The service worker keeps the router's prefetch of
 * each top-level destination (`public/sw.js`, `SHELL_PATHS`), and a destination's loading
 * skeleton is drawn for the viewer's **role** (the Owner's Today has rows a Crew member's has
 * not), so the worker keeps them for one role at a time. The signed-in shell tells it which:
 * a different role than the one it kept them for drops them all, and a signed-out page drops them
 * too (the worker sees that navigation itself). Only the role is sent: no name, no id.
 */
export const SHELL_VIEWER_MESSAGE = "maxoff-shell-viewer";

type Controller = { postMessage: (message: unknown) => void };

/** Tells the page's service worker, when there is one, whose skeletons it may keep. */
export function postShellViewer(controller: Controller | null | undefined, role: ShellRole): void {
  controller?.postMessage({ type: SHELL_VIEWER_MESSAGE, viewer: role });
}
