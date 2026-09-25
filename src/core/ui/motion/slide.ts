import { isStandalone } from "@/core/ui/shell/tab-history";

import { PHONE_QUERY, REDUCED_MOTION_QUERY, slideAllowed } from "./nav-types";

/** `slideAllowed` for this window, now. */
export function canSlide(): boolean {
  return slideAllowed(
    isStandalone(),
    window.matchMedia(PHONE_QUERY).matches,
    window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );
}

/** Calls `onChange` when the width or the motion preference crosses its line. */
export function subscribeSlide(onChange: () => void): () => void {
  const queries = [window.matchMedia(PHONE_QUERY), window.matchMedia(REDUCED_MOTION_QUERY)];
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}

/** Set on `<html>` while a slide React does not start itself runs (`slideBack`). */
export const SLIDE_ATTRIBUTE = "data-nav-slide";

/** How long the swap waits for the `popstate` before the slide gives up and just shows it. */
export const SLIDE_BACK_WAIT_MS = 500;

/**
 * Back one entry with the `nav-back` slide (`BackLink` with an entry of ours beneath).
 *
 * React types the transitions Next starts for a push or a replace, but `router.back()` only
 * moves history. Next answers the `popstate` with a transition that React renders synchronously
 * (so the browser can restore scroll), in the microtask checkpoint right after Next's listener,
 * so no other listener can add a type to it: an earlier one finds no transition to join, a later
 * one finds it already committed (both tried, 2.7b). So this one slide is started by hand: the
 * browser snapshots the page, the history moves, Next commits the parent inside the `popstate`,
 * and the next task takes the new snapshot. `SLIDE_ATTRIBUTE` names the page for that one
 * transition (`globals.css`) with the same `nav-back` class React gives a typed one. Where
 * sliding is not allowed, or the browser has no View Transitions, it is a plain back.
 */
let sliding = false;

export function slideBack(back: () => void): void {
  const root = document.documentElement;
  if (!canSlide() || typeof document.startViewTransition !== "function") {
    back();
    return;
  }
  // Taps pass through to the old page while the slide runs (up to `SLIDE_BACK_WAIT_MS`), and
  // its back control is still there: a second tap must not go back a second level.
  if (sliding) return;
  sliding = true;
  root.setAttribute(SLIDE_ATTRIBUTE, "back");
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        const done = () => {
          window.removeEventListener("popstate", onPop);
          clearTimeout(cap);
          resolve();
        };
        const onPop = () => setTimeout(done);
        const cap = setTimeout(done, SLIDE_BACK_WAIT_MS);
        window.addEventListener("popstate", onPop);
        back();
      }),
  );
  void transition.finished.finally(() => {
    root.removeAttribute(SLIDE_ATTRIBUTE);
    sliding = false;
  });
}
