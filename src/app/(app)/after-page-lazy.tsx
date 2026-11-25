"use client";

import { AfterPage } from "@/core/ui/lazy/after-page";
import type { ShellRole } from "@/core/ui/shell/viewer";

const loadAfterPage = () => import("./after-page").then((module) => module.AppAfterPage);

/** What the shell's after-page part needs to know, from the layout (no read: the viewer's). */
export interface AfterPageProps {
  role: ShellRole;
  /** The bar's tabs and home (`mobileNavFor`), the screens the tap drawings start with. */
  tabs: readonly string[];
  /** The calendar's opening week rows (today's month in IST), for its tap drawing. */
  weeks: number;
}

/**
 * What the signed-in shell loads **after the page** (ARCHITECTURE §19), in one loader: the
 * service-worker helpers (`PwaAfterPage`) and the tap drawings (v7.0). The shell's `afterPage`
 * slot; it replaced the shell's own loader for the helpers, so no screen's first load grew. The
 * props go through as they are (no copy: every byte here is in every screen's first load).
 */
export function AppAfterPageLazy(props: AfterPageProps) {
  return <AfterPage load={loadAfterPage} props={props} />;
}
