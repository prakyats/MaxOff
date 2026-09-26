"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { INITIAL_CHROME_STATE, nextChromeState } from "./chrome-scroll";

/**
 * Drives the mobile brand bar: hidden on scroll down, back on scroll up (ARCHITECTURE §14.1).
 *
 * It renders nothing. It sets `data-chrome` on `<html>`, and CSS does the rest — `globals.css`
 * drops `--app-chrome-h` to zero so the page title bar takes the top edge, and `top-bar.tsx`
 * slides out. Keeping the whole thing in one attribute means the two bars can never disagree
 * about where the top is, and nothing re-renders on scroll.
 *
 * The decision itself is `chrome-scroll.ts`, a pure reducer with its own tests.
 */
export function MobileChrome() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    let state = { ...INITIAL_CHROME_STATE, lastY: window.scrollY };
    let queued = false;

    function apply() {
      queued = false;
      state = nextChromeState(state, window.scrollY);
      const wanted = state.hidden ? "hidden" : "shown";
      // Touching the DOM only on a change keeps this off the style recalc path while scrolling.
      if (root.dataset.chrome !== wanted) root.dataset.chrome = wanted;
    }

    function onScroll() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(apply);
    }

    root.dataset.chrome = "shown";
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      delete root.dataset.chrome;
    };
  }, []);

  // A new page starts at the top with the bar shown; without this a route change from a
  // scrolled-down list would land on a page whose brand bar is already gone.
  useEffect(() => {
    document.documentElement.dataset.chrome = "shown";
  }, [pathname]);

  return null;
}
