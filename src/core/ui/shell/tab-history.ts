"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";

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
 * How each move is made:
 *
 * | From | To | Navigation | Stack after |
 * |---|---|---|---|
 * | home | tab | `push` | `[home, tab]` |
 * | tab | another tab | `replace` | `[home, tab]` |
 * | tab | home | `back` (we pushed it) | `[home]` |
 *
 * Back from a tab therefore lands on home, and back on home has nothing of ours left to pop, so
 * the app closes. Detail routes inside a tab are untouched: they are ordinary `Link`s that push,
 * so back from a client page still returns to the client list rather than to home.
 *
 * `pushedFromHome` is module state, so it resets on a full reload. Refreshing while on a tab
 * therefore costs one redundant history entry the next time you tap home (a `replace` where a
 * `back` would have done). The alternative is writing a marker into `history.state` that Next
 * owns and rewrites on every navigation, which is far more fragile than one spare entry.
 */

let pushedFromHome = false;

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

export interface TabNavigation {
  /** True when this click was handled here; the caller must then prevent the default. */
  navigate: (href: string) => boolean;
}

/**
 * Gives the bottom bar its tab-navigation behaviour. Returns `navigate`, which reports whether
 * it handled the click — in a browser tab it always returns false, so the plain `Link` wins.
 */
export function useTabNavigation(home: string, pathname: string, topLevel: readonly string[]) {
  const router = useRouter();
  const standalone = useIsStandalone();

  // Reaching home by any route — a tap, the back gesture, a redirect — means nothing of ours is
  // left on the stack.
  useEffect(() => {
    if (pathname === home) pushedFromHome = false;
  }, [pathname, home]);

  const navigate = useCallback(
    (href: string) => {
      if (!standalone) return false;
      // Only the top-level tabs are rewritten. Anything deeper pushes normally.
      if (!topLevel.includes(href) || !topLevel.includes(pathname)) return false;
      if (href === pathname) return false;

      if (href === home) {
        if (pushedFromHome) {
          pushedFromHome = false;
          router.back();
        } else {
          router.replace(href);
        }
        return true;
      }

      if (pathname === home) {
        pushedFromHome = true;
        router.push(href);
      } else {
        router.replace(href);
      }
      return true;
    },
    [standalone, topLevel, pathname, home, router],
  );

  return { navigate };
}
