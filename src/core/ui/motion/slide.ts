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

/**
 * Set on `<html>` while a slide runs: `back` or `forward`. `globals.css` reads it to name the
 * route for the view transition and give it the slide's class, whoever started the transition.
 */
export const SLIDE_ATTRIBUTE = "data-nav-slide";

export type SlideDirection = "back" | "forward";

/** How long a named slide waits for its view transition before the name is dropped (nothing came). */
export const SLIDE_ABANDON_MS = 3_000;

let clearTimer: number | undefined;
/** A slide is named and no view transition has taken it yet. */
let named = false;
/** Tags the wrapped `startViewTransition`, so one document is watched once. */
const WATCHED = Symbol.for("maxoff.slide.watch");
type StartViewTransition = typeof document.startViewTransition & { [WATCHED]?: true };

function dropName(): void {
  // Never under a manual slide: `slideBack` owns the attribute until its transition finishes.
  if (sliding) return;
  document.documentElement.removeAttribute(SLIDE_ATTRIBUTE);
}

/**
 * The first view transition started after `nameSlide` is the named slide: its old and new
 * snapshots carry the route's name and class from the attribute, so the name is dropped as soon
 * as both are captured (`ready`), never before (the new state would lose the route) and never
 * later (a view switch or tab change right after would slide too, found by `motion.spec`).
 */
function watchTransitions(): void {
  const current = document.startViewTransition as StartViewTransition | undefined;
  if (typeof current !== "function" || current[WATCHED]) return;
  const real = current.bind(document);
  const watched: StartViewTransition = (arg: never) => {
    const transition = real(arg);
    if (named && !sliding) {
      named = false;
      window.clearTimeout(clearTimer);
      void transition.ready.then(dropName, dropName);
    }
    return transition;
  };
  watched[WATCHED] = true;
  document.startViewTransition = watched;
}

/**
 * Names the slide a drill-down move is about to make (`BackLink`'s replace, `DrillLink`,
 * `OverlayLink`, a dialog's push), beside the transition type the router call carries.
 *
 * React's transition types are kept on the root and **claimed by the next eligible commit**, so a
 * navigation dispatched while React is still hydrating the screen's other Suspense boundaries
 * (a tap in the first moments after the control became live, measured 12 of 12 at 1× and 4× CPU
 * on 2026-10-01; CI's `motion.spec` "opened directly") commits with no type at all: the page
 * changed, the view transition ran, and nothing slid. The attribute does not depend on React's
 * bookkeeping: the CSS names the route and classes it from the attribute for the view transition
 * the commit starts (`watchTransitions` drops the name once that transition has captured both
 * states). A screen that commits without a view transition drops it at the commit
 * (`slideCommitted`); if nothing comes, it goes after `SLIDE_ABANDON_MS`.
 */
export function nameSlide(direction: SlideDirection): void {
  if (!canSlide() || typeof document.startViewTransition !== "function") return;
  if (sliding) return;
  watchTransitions();
  named = true;
  document.documentElement.setAttribute(SLIDE_ATTRIBUTE, direction);
  window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    named = false;
    dropName();
  }, SLIDE_ABANDON_MS);
}

/** The route committed (`RouteTransition`): a slide still named started no view transition. */
export function slideCommitted(): void {
  if (!named) return;
  named = false;
  window.clearTimeout(clearTimer);
  dropName();
}

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
  window.clearTimeout(clearTimer);
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
