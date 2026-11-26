"use client";

import { type ComponentType, useEffect, useState } from "react";

import { whenIdle } from "@/core/ui/lazy/idle-queue";

import type { LiveUpdatesProps } from "./live-updates";

/**
 * The longest the live bell waits for an idle moment (phone-inp, option (a)): evaluating the
 * Realtime client is one 59–78 ms task at CPU ×4, and started straight from the effect it landed
 * 1.0–1.1 s after load, under the first taps on a phone. Idle, it waits for a gap between them;
 * nothing is lost meanwhile, because the first join catches up on whatever came between the
 * server's count and the join (`catchUpRefreshes`).
 */
const LIVE_IDLE_WAIT_MS = 2_500;

/**
 * The live bell, loaded right after the page rather than with it (ARCHITECTURE §19): it draws
 * nothing, and the Realtime client is not small, so it stays out of every screen's first-load
 * JavaScript (`pnpm budget`). Imported in an effect and held in state, not through
 * `next/dynamic`, as `PullToRefreshLazy` explains (a Suspense boundary in the shell stopped the
 * view transitions). The import starts in the first idle moment after the page
 * (`LIVE_IDLE_WAIT_MS`), never inside the load's busiest second.
 */
export function LiveUpdatesLazy(props: LiveUpdatesProps) {
  const [Live, setLive] = useState<ComponentType<LiveUpdatesProps> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const stop = whenIdle(
      () =>
        import("./live-updates").then((module) => {
          if (!cancelled) setLive(() => module.LiveUpdates);
        }),
      LIVE_IDLE_WAIT_MS,
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return Live ? <Live {...props} /> : null;
}
