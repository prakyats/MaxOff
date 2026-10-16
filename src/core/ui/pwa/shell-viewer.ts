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

/**
 * Tells the page's service worker, when there is one, whose skeletons it may keep. `null` says
 * nobody's: the worker drops every kept skeleton and the viewer it kept them for (ADR-0014 item
 * 4). Sign-out says so before it signs out (its redirect is the router's, never a navigation the
 * worker sees), and so does every signed-out page on arrival (an expired session's soft redirect).
 */
export function postShellViewer(
  controller: Controller | null | undefined,
  role: ShellRole | null,
): void {
  controller?.postMessage({ type: SHELL_VIEWER_MESSAGE, viewer: role });
}

/** This page's service worker, when one controls it (none in `next dev`, or before install). */
export function pageController(): Controller | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.controller;
}

/** Drops the instant skeleton's cache and its viewer: nobody is signed in on this device. */
export function forgetShellViewer(): void {
  postShellViewer(pageController(), null);
}
