"use client";

import { type ComponentType, useEffect, useState } from "react";

import type { LiveUpdatesProps } from "./live-updates";

/**
 * The live bell, loaded right after the page rather than with it (ARCHITECTURE §19): it draws
 * nothing, and the Realtime client is not small, so it stays out of every screen's first-load
 * JavaScript (`pnpm budget`). Imported in an effect and held in state, not through
 * `next/dynamic`, as `PullToRefreshLazy` explains (a Suspense boundary in the shell stopped the
 * view transitions).
 */
export function LiveUpdatesLazy(props: LiveUpdatesProps) {
  const [Live, setLive] = useState<ComponentType<LiveUpdatesProps> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("./live-updates").then((module) => {
      if (!cancelled) setLive(() => module.LiveUpdates);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return Live ? <Live {...props} /> : null;
}
