"use client";

import { type ComponentType, type ReactNode, useEffect, useState } from "react";

/** The longest an import waits for the browser to be idle (a busy page still gets its parts). */
const IDLE_WAIT_MS = 2_000;
/** Where the browser cannot say when it is idle (Safari): a short wait after the page instead. */
const NO_IDLE_WAIT_MS = 200;

/** Runs `run` once the browser is idle; the returned function cancels it. */
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: IDLE_WAIT_MS });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(run, NO_IDLE_WAIT_MS);
  return () => window.clearTimeout(timer);
}

/**
 * A client part loaded **right after the page** rather than with it (ARCHITECTURE §19, "What
 * draws nothing at first loads after the page"; 6.0, the first-load diet): the import starts
 * once the page has hydrated **and the browser is idle**, and the component is held in state,
 * never through `next/dynamic` or `React.lazy` (a Suspense boundary in the shell stopped the
 * view transitions; `pull-to-refresh-lazy.tsx`). Until it arrives `fallback` is drawn (the same
 * trigger button, or nothing for a closed dialog), so the first screen paints and answers
 * without it.
 *
 * **Why idle, not straight from the effect** (CI runs 37575602126 and 37587912609,
 * `back-gesture.spec:479`; reproduced with the CPU slowed 8–16×): a tap on a part of the screen
 * React had not hydrated yet made React hydrate it inside that tap, and the import, started from
 * the effect of that hydration, swapped the stand-in for the real menu **between the capture and
 * the bubble of that one pointerdown**: the stand-in never heard the tap and the menu stayed
 * closed (4 of 16 opened). Started at idle, the tap meets the stand-in, which keeps it
 * (`defaultOpen`), and the menu opens once its code is in (16 of 16).
 *
 * `load` is read once per mount: pass a module-level function. A failed import (offline, a chunk
 * from an older deploy) leaves the fallback in place; the next mount tries again.
 */
export function AfterPage<P extends object>({
  load,
  props,
  fallback = null,
}: {
  load: () => Promise<ComponentType<P>>;
  props: P;
  fallback?: ReactNode;
}) {
  const [Loaded, setLoaded] = useState<ComponentType<P> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const start = () => {
      load().then(
        (component) => {
          if (!cancelled) setLoaded(() => component);
        },
        () => undefined,
      );
    };
    const stop = whenIdle(start);
    return () => {
      cancelled = true;
      stop();
    };
    // `load` is a module-level function by contract: loaded once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return Loaded ? <Loaded {...props} /> : fallback;
}
