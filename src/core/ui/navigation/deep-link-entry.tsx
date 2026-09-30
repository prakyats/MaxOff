"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** How long the entry waits for the parent's navigation to land before it gives up. */
const PARENT_WAIT_MS = 15_000;

/**
 * Lays the history down for a deep link (§14.2 h): the current entry (`/open?to=…`) becomes the
 * parent list, then the detail is pushed on top, so the first back goes to the list and the
 * entry page itself is never in the stack. Runs once.
 *
 * The two navigations are made one after the other: the router drops a navigation that another
 * one overtakes before it commits, so a `replace` and a `push` in the same tick leave only the
 * push (and `/open` under it, which would run again on back). The push waits until the parent's
 * URL is in place; the parent's loading screen may show for that moment. The wait outlives this
 * component (the replace unmounts it), and stops after `PARENT_WAIT_MS` with the parent shown.
 */
export function DeepLinkEntry({ to, parent }: { to: string; parent: string }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const parentPath = new URL(parent, window.location.origin).pathname;
    const started = performance.now();
    router.replace(parent);
    const pushWhenParentLands = () => {
      if (window.location.pathname === parentPath) {
        router.push(to);
        return;
      }
      if (performance.now() - started < PARENT_WAIT_MS) {
        window.setTimeout(pushWhenParentLands, 16);
      }
    };
    pushWhenParentLands();
  }, [router, to, parent]);
  return null;
}
