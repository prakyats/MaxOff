"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { systemClock } from "@/core/time/clock";
import { Button } from "@/core/ui/primitives/button";

import {
  isNavigationFetch,
  NAV_DONE_ATTRIBUTE,
  NAV_PENDING_ATTRIBUTE,
  NAV_TARGET_ATTRIBUTE,
  navStage,
  type NavStage,
} from "./progress";

/** How long a tap may go without the router starting anything before the bar stands down. */
const IDLE_CANCEL_MS = 600;
/** How long the finished bar stays full before it fades (`globals.css`). */
const DONE_MS = 300;

/** The page's address without its hash: a hash-only change is not a navigation. */
function here(): string {
  return location.pathname + location.search;
}

/**
 * The navigation progress bar (ARCHITECTURE §14.2 i, owner 2026-09-28), mounted once in the root
 * layout. The bar itself is CSS on `html[data-nav-pending]` (`globals.css`), so it shows on the
 * tap, before hydration and before the server has answered; this component:
 *
 * - **starts** it for navigations no tap started: any router fetch for a screen (`router.push`,
 *   `router.replace`, a redirect, a refresh on return), by watching `fetch` for the RSC request,
 *   and the browser's back and forward (`popstate`);
 * - **finishes** it once the address has changed and no route skeleton (`loading-state`) is left
 *   in `main`: the new screen is really there, not just its outline. A fetch that ends without an
 *   address change (a refresh) finishes it too;
 * - **stands down** quietly when a tap turns out not to navigate (the unsaved-changes guard held
 *   it): nothing started within `IDLE_CANCEL_MS` and the page is not unloading;
 * - after 8 s says the connection is slow, after 10 s offers **Retry** (the same move again: the
 *   tapped link is clicked again, or the address pushed), after 25 s also **Reload** (a full load
 *   of the destination). Never a history entry, never a layer: back is unaffected.
 */
export function NavProgress() {
  const router = useRouter();
  const [stage, setStage] = useState<NavStage | null>(null);
  const destination = useRef<string | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    let startedAt = 0;
    let from = "";
    let fetches = 0;
    let fetched = false;
    let unloading = false;
    let doneTimer = 0;
    let frame = 0;
    let ticker = 0;

    const pending = () => html.hasAttribute(NAV_PENDING_ATTRIBUTE);

    const clear = () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(ticker);
      for (const link of document.querySelectorAll(`[${NAV_TARGET_ATTRIBUTE}]`)) {
        link.removeAttribute(NAV_TARGET_ATTRIBUTE);
      }
      html.removeAttribute(NAV_PENDING_ATTRIBUTE);
      destination.current = null;
      setStage(null);
    };

    const finish = () => {
      if (!pending()) return;
      clear();
      html.setAttribute(NAV_DONE_ATTRIBUTE, "");
      window.clearTimeout(doneTimer);
      doneTimer = window.setTimeout(() => html.removeAttribute(NAV_DONE_ATTRIBUTE), DONE_MS);
    };

    // One loop per navigation: arrival, standing down, and the slow messages.
    const watch = () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(ticker);
      const check = () => {
        if (!pending()) return;
        const moved = here() !== from;
        const skeleton = document.querySelector('main [data-slot="loading-state"]');
        if ((moved && !skeleton) || (!moved && fetched && fetches === 0)) {
          finish();
          return;
        }
        const elapsed = systemClock().getTime() - startedAt;
        if (!moved && fetches === 0 && !fetched && !unloading && elapsed > IDLE_CANCEL_MS) {
          clear();
          return;
        }
        frame = window.requestAnimationFrame(check);
      };
      frame = window.requestAnimationFrame(check);
      ticker = window.setInterval(() => {
        const next = navStage(systemClock().getTime() - startedAt);
        setStage(next === "working" ? null : next);
      }, 500);
    };

    // A navigation begins (a tap marked the document already, or the router started one).
    const begin = (to: string | null) => {
      window.clearTimeout(doneTimer);
      html.removeAttribute(NAV_DONE_ATTRIBUTE);
      if (!pending()) html.setAttribute(NAV_PENDING_ATTRIBUTE, String(systemClock().getTime()));
      startedAt = Number(html.getAttribute(NAV_PENDING_ATTRIBUTE)) || systemClock().getTime();
      from = here();
      fetched = false;
      if (to) destination.current = to;
      watch();
    };

    // A tap before hydration may already have started one: carry on from its start time.
    if (pending()) {
      const target = document.querySelector(`[${NAV_TARGET_ATTRIBUTE}]`);
      begin(target?.getAttribute(NAV_TARGET_ATTRIBUTE) ?? null);
    }

    // Taps: the head script marks the document in the capture phase; pick it up after the
    // app's own handlers have run (bubble phase on window, the last to hear the click).
    const onClick = () => {
      if (!pending()) return;
      const target = document.querySelector(`[${NAV_TARGET_ATTRIBUTE}]`);
      begin(target?.getAttribute(NAV_TARGET_ATTRIBUTE) ?? null);
    };
    const onPopState = () => begin(null);
    const onUnload = () => {
      unloading = true;
    };

    // Router fetches: `router.push`/`replace`, redirects and refreshes reach the server here.
    const realFetch = window.fetch;
    const patched: typeof window.fetch = (input, init) => {
      const request = input instanceof Request ? input : null;
      const method = init?.method ?? request?.method ?? "GET";
      const headers = new Headers(init?.headers ?? request?.headers);
      if (!isNavigationFetch(method, headers)) return realFetch(input, init);
      const url = new URL(request?.url ?? String(input), location.href);
      url.searchParams.delete("_rsc");
      const to = url.pathname + url.search;
      // A refresh of the screen you are on (refresh on return, pull-to-refresh with its own
      // spinner) is not a navigation: no bar for it unless a tap already started one.
      if (!pending() && to === here()) return realFetch(input, init);
      if (!pending()) begin(to);
      else if (!destination.current) destination.current = to;
      fetches++;
      const settle = () => {
        fetches--;
        fetched = true;
      };
      return realFetch(input, init).then(
        (response) => {
          settle();
          return response;
        },
        (error: unknown) => {
          settle();
          throw error;
        },
      );
    };
    window.fetch = patched;

    window.addEventListener("click", onClick);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      if (window.fetch === patched) window.fetch = realFetch;
      window.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onUnload);
      window.cancelAnimationFrame(frame);
      window.clearInterval(ticker);
      window.clearTimeout(doneTimer);
    };
  }, []);

  const retry = () => {
    const to = destination.current;
    const link = document.querySelector<HTMLElement>(`[${NAV_TARGET_ATTRIBUTE}]`);
    // The same move again: the tapped link knows whether it pushes, replaces or goes back.
    if (link?.isConnected) link.click();
    else if (to) router.push(to);
  };
  const reload = () => {
    const to = destination.current;
    if (to) window.location.assign(to);
    else window.location.reload();
  };

  return (
    <div data-slot="nav-progress" aria-hidden={stage === null}>
      <div data-slot="nav-progress-bar" />
      {stage ? (
        <div
          data-slot="nav-progress-status"
          role="status"
          className="bg-popover text-popover-foreground border-border fixed top-[calc(var(--app-safe-top,0px)+0.5rem)] left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border py-1 pr-1 pl-3 text-sm shadow-md"
        >
          <span>
            {stage === "slow" ? "Still working… slow connection" : "Taking longer than usual"}
          </span>
          {stage === "retry" || stage === "reload" ? (
            <Button size="sm" variant="secondary" onClick={retry} data-slot="nav-retry">
              Retry
            </Button>
          ) : null}
          {stage === "reload" ? (
            <Button size="sm" variant="ghost" onClick={reload} data-slot="nav-reload">
              Reload
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
