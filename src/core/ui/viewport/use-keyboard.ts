"use client";

import { useSyncExternalStore } from "react";

import { keyboardState, type KeyboardState } from "./keyboard";

/**
 * The keyboard as the page sees it (`keyboard.ts`), live: `inset` (how far it covers the layout
 * viewport's bottom) and the visible `height`. Follows `visualViewport`'s resize and scroll. One
 * shared snapshot per change, so every user re-renders with the same numbers. On the server and
 * before hydration: closed.
 */
let current: KeyboardState | null = null;

function read(): KeyboardState {
  const next = keyboardState(window.innerHeight, window.visualViewport);
  if (!current || current.inset !== next.inset || current.height !== next.height) current = next;
  return current;
}

function subscribe(onChange: () => void): () => void {
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", onChange);
  viewport?.addEventListener("scroll", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    viewport?.removeEventListener("resize", onChange);
    viewport?.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}

const CLOSED: KeyboardState = { inset: 0, height: 0 };

export function useKeyboard(): KeyboardState {
  return useSyncExternalStore(subscribe, read, () => CLOSED);
}
