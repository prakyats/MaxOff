"use client";

import { type ComponentType, type ReactNode, useEffect, useState } from "react";

/**
 * A client part loaded **right after the page** rather than with it (ARCHITECTURE §19, "What
 * draws nothing at first loads after the page"; 6.0, the first-load diet): the import starts in
 * an effect once the page has hydrated, and the component is held in state, never through
 * `next/dynamic` or `React.lazy` (a Suspense boundary in the shell stopped the view transitions;
 * `pull-to-refresh-lazy.tsx`). Until it arrives `fallback` is drawn (the same trigger button, or
 * nothing for a closed dialog), so the first screen paints and answers without it.
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
    load().then(
      (component) => {
        if (!cancelled) setLoaded(() => component);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // `load` is a module-level function by contract: loaded once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return Loaded ? <Loaded {...props} /> : fallback;
}
