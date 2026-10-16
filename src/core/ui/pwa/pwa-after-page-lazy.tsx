"use client";

import { AfterPage } from "@/core/ui/lazy/after-page";
import type { ShellRole } from "@/core/ui/shell/viewer";

const loadPwaAfterPage = () => import("./pwa-after-page").then((module) => module.PwaAfterPage);

/**
 * The shell's service-worker helpers (P2: the instant skeleton's viewer and the warm-up),
 * **loaded after the page** (ARCHITECTURE §19): they draw nothing, so they stay out of every
 * screen's first-load JavaScript.
 */
export function PwaAfterPageLazy({ role }: { role: ShellRole }) {
  return <AfterPage load={loadPwaAfterPage} props={{ role }} />;
}
