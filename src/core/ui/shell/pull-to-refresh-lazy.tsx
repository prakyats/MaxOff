"use client";

import { type ComponentType, useEffect, useState } from "react";

type Props = { tabRoots: readonly string[] };

/**
 * Pull-to-refresh, loaded right after the page rather than with it (ARCHITECTURE §19): it draws
 * nothing until someone pulls, so it has no place in a screen's first-load JavaScript (`pnpm
 * budget`). Imported in an effect and held in state, **not** through `next/dynamic` or
 * `React.lazy`: a client-only Suspense boundary inside the app shell stopped React's view
 * transitions (the drill-down slide) and held back the progress bar's slow line during
 * navigations (found by the e2e suite). It marks `html[data-pull-ready]` once it is listening.
 */
export function PullToRefreshLazy(props: Props) {
  const [Pull, setPull] = useState<ComponentType<Props> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("./pull-to-refresh").then((module) => {
      if (!cancelled) setPull(() => module.PullToRefresh);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return Pull ? <Pull {...props} /> : null;
}
