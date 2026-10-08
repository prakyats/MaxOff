"use client";

import { Loader2Icon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { systemClock } from "@/core/time/clock";
import { Button } from "@/core/ui/primitives/button";

import {
  actionLeavesScreen,
  headingElsewhere,
  isNavigationFetch,
  isRouterActionFetch,
  NAV_DONE_ATTRIBUTE,
  NAV_PENDING_ATTRIBUTE,
  NAV_TARGET_ATTRIBUTE,
  navigationDone,
  navStage,
  type NavStage,
} from "./progress";
import {
  TAB_ATTRIBUTE,
  TAB_HOME_ATTRIBUTE,
  TAB_TOP_ATTRIBUTE,
  VIEW_LINK_ATTRIBUTE,
} from "./attributes";
import { writingOwnHistory } from "./history-writes";
import { backMove, tabMove } from "./moves";
import {
  endOnCompletion,
  noteRouterCommitted,
  noteRouterFetchStarted,
  noteScreenFetchSettled,
} from "./screen-fetches";

/** How long a tap may go without the router starting anything before the bar stands down. */
const IDLE_CANCEL_MS = 600;
/** How long the finished bar stays full before it fades (`globals.css`). */
const DONE_MS = 300;
/** A `beforeunload` that did not unload (a `tel:` link, a download) is forgotten after this. */
const UNLOAD_GRACE_MS = 2_000;
/** Anything that owns the screen while open: the status line waits until it has closed. */
const OVERLAY = '[role="dialog"], [role="alertdialog"]';

/** How a navigation began: it decides what Retry repeats (§14.2 i). */
type Kind = "tap" | "router" | "history";

/** Whether the app runs installed: a tab move then replaces (§14.2 c). */
function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

type NavigationLike = {
  currentEntry?: { index: number } | null;
  entries?: () => { url: string | null }[];
};

/**
 * The move a tapped link made, for loading its destination in full (§14.2 b–d, the rules in
 * `moves.ts` that the links and the head script share): a view control replaces; the back
 * control goes back when an entry of the app is beneath and otherwise replaces with the parent;
 * an installed tab pushes, replaces or goes back as `tabMove` says; anything else pushes.
 */
function fullLoadMove(link: HTMLElement | null, to: string): "push" | "replace" | "back" {
  const navigation = (window as { navigation?: NavigationLike }).navigation;
  const index = navigation?.currentEntry?.index;
  if (link?.hasAttribute(VIEW_LINK_ATTRIBUTE)) return "replace";
  if (link?.getAttribute("data-slot") === "page-back") {
    return backMove(index) === "back" ? "back" : "replace";
  }
  if (link?.hasAttribute(TAB_ATTRIBUTE)) {
    const bar = link.closest(`[${TAB_HOME_ATTRIBUTE}]`);
    const home = bar?.getAttribute(TAB_HOME_ATTRIBUTE) ?? "";
    const below = index !== undefined && index > 0 ? navigation?.entries?.()[index - 1] : null;
    const move = tabMove({
      href: new URL(to, location.href).pathname,
      pathname: location.pathname,
      home,
      topLevel: (bar?.getAttribute(TAB_TOP_ATTRIBUTE) ?? "").split(" "),
      standalone: standalone(),
      pushedFromHome: Boolean(below?.url && new URL(below.url).pathname === home),
    });
    if (move === "back" || move === "replace") return move;
  }
  return "push";
}

/** The page's address without its hash: a hash-only change is not a navigation. */
function here(): string {
  return location.pathname + location.search;
}

/**
 * The bar itself: a plain element, in the root layout's server HTML, so the CSS on
 * `html[data-nav-pending]` draws it on a tap before anything has hydrated (§14.2 i).
 */
export function NavProgressBar() {
  return <div data-slot="nav-progress-bar" aria-hidden />;
}

/**
 * What drives the bar (ARCHITECTURE §14.2 i, owner 2026-09-28 and 2026-09-29), mounted once in the
 * root layout inside `<Suspense>` (it reads the address through Next's hooks):
 *
 * - **starts** it for navigations no tap started: any router fetch for another screen
 *   (`router.push`/`replace`, a redirect), by watching `fetch`, and back or forward to **another
 *   address** (`popstate`). Closing a sheet or dialog is a history move back to the same address,
 *   so it never starts the bar;
 * - **finishes** it once the address has changed and no route skeleton (`loading-state`) is left
 *   in `main`, or at most `NAV_SETTLE_MS` after the destination's fetch has answered (a section
 *   that loads on its own may keep a skeleton); a fetch that ends without an address change (a
 *   refresh) finishes it too;
 * - **stands down** quietly when a tap turns out not to navigate (the unsaved-changes guard held
 *   it): nothing started within `IDLE_CANCEL_MS`. A page that is really unloading is left alone,
 *   and a `beforeunload` that did not unload is forgotten after `UNLOAD_GRACE_MS`;
 * - after 8 s shows one quiet line, "Still loading" with **Retry**: the tapped link clicked again
 *   (the same move, no extra history entry), or, for a back or forward, the screen it reached
 *   asked for again; after 25 s Retry loads the destination in full with the same move
 *   (`fullLoadMove`). Never while a dialog or sheet is open, never a layer, never a history entry.
 */
export function NavProgress() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [stage, setStage] = useState<NavStage | null>(null);
  const destination = useRef<string | null>(null);
  const kind = useRef<Kind>("tap");
  // The address the app is showing, as React last rendered it: at a `popstate` it is still the
  // address before the move, so a move to the same address (an overlay closing) is told apart.
  const shown = useRef("");
  useEffect(() => {
    const query = search.toString();
    shown.current = pathname + (query ? `?${query}` : "");
  }, [pathname, search]);

  useEffect(() => {
    const html = document.documentElement;
    let startedAt = 0;
    let from = "";
    let movedAt = 0;
    let settledAt = 0;
    let fetches = 0;
    // The addresses of the counted fetches still in flight (one entry per fetch).
    const inFlight: string[] = [];
    let fetched = false;
    // A counted fetch for another address: then only the address changing ends the bar. A fetch
    // for the address it started from is a refresh, which ends it when it answers.
    let elsewhere = false;
    let unloading = false;
    let unloadTimer = 0;
    let doneTimer = 0;
    let frame = 0;
    let ticker = 0;

    const pending = () => html.hasAttribute(NAV_PENDING_ATTRIBUTE);
    const now = () => systemClock().getTime();

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

    // One loop per navigation: arrival, standing down, and the slow line.
    const watch = () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(ticker);
      const check = () => {
        if (!pending()) return;
        const t = now();
        const moved = here() !== from;
        if (moved && !movedAt) movedAt = t;
        const done = navigationDone({
          moved,
          skeleton: document.querySelector('main [data-slot="loading-state"]') !== null,
          answered: fetched && fetches === 0,
          elsewhere,
          idle: fetches === 0,
          sinceAnswered: settledAt ? t - settledAt : 0,
          sinceMoved: movedAt ? t - movedAt : 0,
        });
        if (done) {
          finish();
          return;
        }
        if (!moved && fetches === 0 && !fetched && !unloading && t - startedAt > IDLE_CANCEL_MS) {
          clear();
          return;
        }
        frame = window.requestAnimationFrame(check);
      };
      frame = window.requestAnimationFrame(check);
      ticker = window.setInterval(() => {
        const next = navStage(now() - startedAt);
        const covered = document.querySelector(OVERLAY) !== null;
        setStage(next === "working" || covered ? null : next);
      }, 500);
    };

    // A navigation begins (a tap marked the document already, or the router started one).
    const begin = (to: string | null, how: Kind, origin: string = here()) => {
      window.clearTimeout(doneTimer);
      html.removeAttribute(NAV_DONE_ATTRIBUTE);
      if (!pending()) html.setAttribute(NAV_PENDING_ATTRIBUTE, String(now()));
      startedAt = Number(html.getAttribute(NAV_PENDING_ATTRIBUTE)) || now();
      // A back or forward has already changed the address: it is measured from where it left.
      from = origin;
      kind.current = how;
      // A tap's own router fetch went out before this (`headingElsewhere`): it still counts.
      elsewhere = headingElsewhere(inFlight, origin);
      movedAt = 0;
      settledAt = 0;
      fetched = false;
      if (to) destination.current = to;
      watch();
    };

    // A tap before hydration may already have started one: carry on from its start time.
    if (pending()) {
      const target = document.querySelector(`[${NAV_TARGET_ATTRIBUTE}]`);
      begin(target?.getAttribute(NAV_TARGET_ATTRIBUTE) ?? null, "tap");
    }

    // Taps: the head script marks the document in the capture phase; pick it up after the
    // app's own handlers have run (bubble phase on window, the last to hear the click).
    const onClick = () => {
      if (!pending()) return;
      const target = document.querySelector(`[${NAV_TARGET_ATTRIBUTE}]`);
      begin(target?.getAttribute(NAV_TARGET_ATTRIBUTE) ?? null, "tap");
    };
    // Back or forward: only a move to another address is a navigation. Closing a sheet or a
    // dialog goes back to the entry beneath at the same address (§14.2 a).
    const onPopState = () => {
      if (here() === shown.current) return;
      begin(here(), "history", shown.current);
    };
    const onUnload = () => {
      unloading = true;
      window.clearTimeout(unloadTimer);
      unloadTimer = window.setTimeout(() => {
        unloading = false;
      }, UNLOAD_GRACE_MS);
    };

    // Router fetches: `router.push`/`replace`, redirects and refreshes reach the server here.
    const realFetch = window.fetch;
    const patched: typeof window.fetch = (input, init) => {
      const request = input instanceof Request ? input : null;
      const method = init?.method ?? request?.method ?? "GET";
      const headers = new Headers(init?.headers ?? request?.headers);
      // Every router fetch, an action's answer too, holds a view's address until it completes
      // (`view-address.ts`).
      if (isRouterActionFetch(method, headers)) {
        const answer = realFetch(input, init);
        endOnCompletion(answer, noteRouterFetchStarted(), "action", (response) =>
          actionLeavesScreen(response.headers),
        );
        return answer;
      }
      if (!isNavigationFetch(method, headers)) return realFetch(input, init);
      const url = new URL(request?.url ?? String(input), location.href);
      url.searchParams.delete("_rsc");
      const to = url.pathname + url.search;
      // Every screen fetch reports when it has answered (pull-to-refresh waits on its own).
      const reported = (response: Promise<Response>) => {
        const report = () => noteScreenFetchSettled(to);
        response.then(report, report);
        return response;
      };
      const send = () => {
        const answer = realFetch(input, init);
        endOnCompletion(answer, noteRouterFetchStarted());
        return answer;
      };
      // A refresh of the screen you are on (refresh on return, pull-to-refresh with its own
      // spinner) is not a navigation: no bar for it unless a tap already started one.
      if (!pending() && to === here()) return reported(send());
      if (!pending()) begin(to, "router");
      else if (!destination.current) destination.current = to;
      if (to !== from) elsewhere = true;
      fetches++;
      inFlight.push(to);
      const settle = () => {
        fetches--;
        inFlight.splice(inFlight.indexOf(to), 1);
        fetched = true;
        settledAt = now();
      };
      return reported(
        send().then(
          (response) => {
            settle();
            return response;
          },
          (error: unknown) => {
            settle();
            throw error;
          },
        ),
      );
    };
    window.fetch = patched;

    // The router's commits: Next writes its own entry (`__NA`) on each one; the app's own writes
    // say so (`history-writes.ts`). An action's answer is only done once committed
    // (`endOnCompletion`).
    const realPush = window.history.pushState;
    const realReplace = window.history.replaceState;
    const committing = (data: unknown) =>
      !writingOwnHistory() && typeof data === "object" && data !== null && "__NA" in data;
    const pushState: History["pushState"] = function (this: History, data, unused, url) {
      realPush.call(this, data, unused, url);
      if (committing(data)) noteRouterCommitted();
    };
    const replaceState: History["replaceState"] = function (this: History, data, unused, url) {
      realReplace.call(this, data, unused, url);
      if (committing(data)) noteRouterCommitted();
    };
    window.history.pushState = pushState;
    window.history.replaceState = replaceState;

    window.addEventListener("click", onClick);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      if (window.fetch === patched) window.fetch = realFetch;
      if (window.history.pushState === pushState) window.history.pushState = realPush;
      if (window.history.replaceState === replaceState) window.history.replaceState = realReplace;
      window.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onUnload);
      window.cancelAnimationFrame(frame);
      window.clearInterval(ticker);
      window.clearTimeout(doneTimer);
      window.clearTimeout(unloadTimer);
    };
  }, []);

  const retry = () => {
    const to = destination.current;
    const link = document.querySelector<HTMLElement>(`[${NAV_TARGET_ATTRIBUTE}]`);
    // A back or forward (a `popstate`) already stands on its address: repeating it would go one
    // level further, so the screen there is asked for again (at 25 s, loaded in full) instead.
    if (kind.current === "history") {
      if (stage === "stuck") window.location.reload();
      else router.refresh();
      return;
    }
    // Long past hope for the router: the destination, loaded in full, with the same move the
    // tap made (`fullLoadMove`, the app's own rules), so the back stack stays as it would be.
    if (stage === "stuck" && to) {
      const move = fullLoadMove(link, to);
      if (move === "back") window.history.back();
      else if (move === "replace") window.location.replace(to);
      else window.location.assign(to);
      return;
    }
    // The same move again: the tapped link knows whether it pushes, replaces or goes back.
    if (link?.isConnected) link.click();
    else if (to) router.push(to);
  };

  if (!stage) return null;
  return (
    <div
      data-slot="nav-progress-status"
      role="status"
      className="bg-background/95 text-muted-foreground ring-border fixed top-[calc(var(--app-safe-top)+0.375rem)] left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1.5 rounded-full py-1 pr-1 pl-2.5 text-xs shadow-sm ring-1 backdrop-blur"
    >
      <Loader2Icon className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      <span>Still loading</span>
      {/* Quiet: underlined text, not a boxed button (it isn't a commit); the shell's 44px minimum
          for buttons gives it its tap area on a phone, the negative margin keeps the line small.
          The shared `Button` on purpose: it keeps `Button` in the root layout's chunk, so pages
          reuse it instead of each bundling a copy (the first-load budget, `pnpm budget`). */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-slot="nav-retry"
        onClick={retry}
        className="-my-3 underline underline-offset-2"
      >
        Retry
      </Button>
    </div>
  );
}
