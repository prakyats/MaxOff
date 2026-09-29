"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";

import { tabMove } from "@/core/ui/navigation/moves";

import { holdScroll, saveTabScroll, takeTabScroll } from "./tab-scroll";

/**
 * Top-level tabs must not stack up history (task 1.5, ARCHITECTURE §14.1).
 *
 * Visiting five tabs used to mean five back presses to leave. Every native app answers back from
 * a top-level tab by going to the **home** tab, and back at home by leaving the app, so that is
 * the rule here: the tab history is never deeper than `[home, currentTab]`.
 *
 * **Installed only.** This is deliberately gated on `display-mode: standalone`, not on screen
 * width: a phone *browser* tab is still a web page, where back and forward should retrace steps
 * exactly as everywhere else on the web, and rewriting that would break the browser's own UI.
 * Installed behaves like an app, browser behaves like a website.
 *
 * How each move is made (`tabMove` in `navigation/moves.ts`, shared with the pre-hydration
 * script, task 2.8):
 *
 * | From | To | Navigation | Stack after |
 * |---|---|---|---|
 * | home | tab | `push` | `[home, tab]` |
 * | tab | another tab | `replace` | `[home, tab]` |
 * | tab | home | `back` (we pushed it) | `[home]` |
 *
 * Back from a tab therefore lands on home, and back on home has nothing of ours left to pop, so
 * the app closes. Every one of these moves also keeps the scroll of the tab it leaves and puts
 * back the scroll of the tab it reaches (`tab-scroll`, §14.2 g). Detail routes inside a tab are untouched: they are ordinary `Link`s that push,
 * so back from a client page still returns to the client list rather than to home.
 *
 * `pushedFromHome` is module state, so it resets on a full reload. Refreshing while on a tab
 * therefore costs one redundant history entry the next time you tap home (a `replace` where a
 * `back` would have done). The alternative is writing a marker into `history.state` that Next
 * owns and rewrites on every navigation, which is far more fragile than one spare entry.
 */

let pushedFromHome = false;

/** The tab a move of ours is heading to, and where that tab was left. */
let arriving: { tab: string; y: number | undefined } | null = null;

/** True when the app is running installed rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayMode = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  // iOS Safari predates display-mode and reports this instead.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return displayMode || iosStandalone;
}

/** Never subscribes: a window cannot move between installed and browser while it is open. */
const noSubscribe = () => () => {};

/**
 * False on the server and for the first client render, then the real value — which is what
 * `useSyncExternalStore` is for. Reading it in an effect and calling `setState` would work but
 * costs a second render on every page.
 */
export function useIsStandalone(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => isStandalone(),
    () => false,
  );
}

/**
 * Backs out of a tab we pushed from home, then runs `fn` (§14.2 e, 3b.1): "Sign out of this
 * device" lives on Me, a tab above home in the installed app's stack, and its redirect to /login
 * replaces only the current entry, so home would stay underneath and back would return to the
 * app. Stepping back to home first leaves /login alone on the stack. In a browser tab, or when
 * nothing of ours was pushed, `fn` runs at once. Waits for the popstate, never a timer.
 */
export function backToHomeThen(fn: () => void): void {
  if (!pushedFromHome || !isStandalone()) {
    fn();
    return;
  }
  pushedFromHome = false;
  window.addEventListener("popstate", () => fn(), { once: true });
  window.history.back();
}

export interface TabNavigation {
  /** True when this click was handled here; the caller must then prevent the default. */
  navigate: (href: string) => boolean;
  /** Whether `navigate(href)` would handle it, asked before anything is prevented. */
  handles: (href: string) => boolean;
}

/**
 * Gives the bottom bar its tab-navigation behaviour. Returns `navigate`, which reports whether
 * it handled the click — in a browser tab it always returns false, so the plain `Link` wins.
 */
/**
 * Prefetch every top-level destination once the app is idle (ARCHITECTURE §19, P5): the bar's
 * visible links prefetch themselves, but the More sheet's pages and home are not on screen, and
 * the installed app reaches all of them through `router.push`/`replace`, which only use what is
 * already cached. A dynamic route prefetches up to its `loading.tsx`, so the tap shows the
 * destination's skeleton at once and the data follows; no page is rendered ahead of time. Never
 * the page you are on: its prefetch could answer a pull-to-refresh with the data from before the
 * pull (found by the e2e suite under load), and it is already on screen.
 */
export function usePrefetchTabs(hrefs: readonly string[], pathname: string): void {
  const router = useRouter();
  useEffect(() => {
    const run = () => {
      for (const href of hrefs) if (href !== pathname) router.prefetch(href);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(run, { timeout: 3000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(run, 1500);
    return () => window.clearTimeout(timer);
  }, [hrefs, pathname, router]);
}

export function useTabNavigation(
  home: string,
  pathname: string,
  topLevel: readonly string[],
): TabNavigation {
  const router = useRouter();
  const standalone = useIsStandalone();

  // Reaching home by any route — a tap, the back gesture, a redirect — means nothing of ours is
  // left on the stack.
  useEffect(() => {
    if (pathname === home) pushedFromHome = false;
  }, [pathname, home]);

  // A layout effect, so the place is back before the arrival paints. It runs after Next's own
  // scroll-to-top for the same commit (the bottom bar comes after the page in the tree), and
  // `holdScroll` covers a page that streams in after it.
  useLayoutEffect(() => {
    // Anywhere else (a drill-down, a redirect) is not the arrival we were waiting for.
    if (arriving?.tab !== pathname) {
      arriving = null;
      return;
    }
    const { y } = arriving;
    if (!y) return;
    // Cleared once the hold has run its course, so a later mount of the bar never re-applies it.
    return holdScroll(y, () => {
      arriving = null;
    });
  }, [pathname]);

  const move = useCallback(
    (href: string) =>
      // Only the top-level tabs are rewritten, installed only. Anything deeper pushes normally.
      tabMove({ href, pathname, home, topLevel, standalone, pushedFromHome }),
    [pathname, home, topLevel, standalone],
  );

  const handles = useCallback((href: string) => move(href) !== null, [move]);

  const navigate = useCallback(
    (href: string) => {
      const next = move(href);
      if (next === null) return false;

      saveTabScroll(pathname, window.scrollY);
      arriving = { tab: href, y: takeTabScroll(href) };

      if (next === "back") {
        pushedFromHome = false;
        router.back();
      } else if (next === "push") {
        pushedFromHome = true;
        router.push(href);
      } else {
        router.replace(href);
      }
      return true;
    },
    [move, pathname, router],
  );

  return { navigate, handles };
}
