"use client";

import { useSyncExternalStore } from "react";

/**
 * "A laptop" for the keyboard rules (ARCHITECTURE §14.3): **a fine pointer that hovers, and no
 * touch anywhere**. A phone, a tablet and a touch-screen laptop are all touch: Enter makes a new
 * line there, nothing is focused on open and no key hint is shown, so the on-screen keyboard
 * never opens uninvited and nothing is sent by accident.
 */
export const FINE_POINTER_QUERY = "(pointer: fine) and (hover: hover)";
export const ANY_COARSE_QUERY = "(any-pointer: coarse)";

type MatchMedia = (query: string) => { matches: boolean };

/** The rule itself, given a `matchMedia` (unit-tested). False without one (the server). */
export function isFinePointer(matchMedia: MatchMedia | undefined): boolean {
  if (!matchMedia) return false;
  return matchMedia(FINE_POINTER_QUERY).matches && !matchMedia(ANY_COARSE_QUERY).matches;
}

/** Read at the moment a key or an opening needs it (never cached: a tablet's keyboard docks). */
export function finePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return isFinePointer((query) => window.matchMedia(query));
}

/** A Mac (⌘ rather than Ctrl in the hints), from `userAgentData` where there is one. */
export function isMacPlatform(platform: string | undefined): boolean {
  return /mac/i.test(platform ?? "");
}

function platformName(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform || navigator.platform;
}

/** "⌘" on a Mac, "Ctrl" elsewhere: the label the hints use. */
export function submitModifierLabel(): "⌘" | "Ctrl" {
  return isMacPlatform(platformName()) ? "⌘" : "Ctrl";
}

/** The `aria-keyshortcuts` value for the submit chord on this platform. */
export function submitShortcut(): "Meta+Enter" | "Control+Enter" {
  return isMacPlatform(platformName()) ? "Meta+Enter" : "Control+Enter";
}

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const queries = [window.matchMedia(FINE_POINTER_QUERY), window.matchMedia(ANY_COARSE_QUERY)];
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}

/**
 * Whether to draw the laptop's key hints. **False on the server and through hydration**, so a
 * hint is never in the server's HTML and a phone never sees one appear (no layout shift there);
 * on a laptop it appears once the page is live, when the keys work.
 */
export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribe, finePointer, () => false);
}
