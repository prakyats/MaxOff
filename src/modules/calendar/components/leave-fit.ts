import { type RefObject, useEffect, useLayoutEffect } from "react";

/** A leave label's two wordings, chosen by `fitLeaveLabels`. */
export const LEAVE_FIT = "data-leave-fit";

/**
 * On a leave label (`data-leave-fit`): one line, clipped (never an ellipsis), and only the
 * wording its `data-leave-fit` names shown (long until measured).
 */
export const LEAVE_FIT_LABEL =
  "overflow-hidden whitespace-nowrap [&[data-leave-fit=short]_[data-leave-word=long]]:hidden [&:not([data-leave-fit=short])_[data-leave-word=short]]:hidden";

/**
 * Picks each leave label's wording under `root` (v1.8 calendar toolbar item 2, owner 23 Oct: a
 * leave bar never truncates to "Prakyat · On l…"): "Prakyat · On leave" where it fits on its one
 * line, else the short "Prakyat · Leave". A label is an element with `data-leave-fit` holding a
 * `data-leave-word="long"` and a `data-leave-word="short"` span; CSS shows the one its
 * `data-leave-fit` names. All are set long first, then read, then the ones that overflow set
 * short: one layout read for the lot.
 */
export function fitLeaveLabels(root: HTMLElement): void {
  const labels = [...root.querySelectorAll<HTMLElement>(`[${LEAVE_FIT}]`)];
  for (const label of labels) label.setAttribute(LEAVE_FIT, "long");
  const short = labels.filter((label) => label.scrollWidth > label.clientWidth);
  for (const label of short) label.setAttribute(LEAVE_FIT, "short");
}

/** Server-safe layout effect: the label is chosen before the browser paints. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Keeps the leave labels under `ref` fitted (`fitLeaveLabels`): after every render (new days, a
 * new view) and whenever the area changes size (the window, the sidebar). The laptop's month bars
 * and its Week and Day all-day chips; the phone is unchanged.
 */
export function useLeaveFit(ref: RefObject<HTMLElement | null>): void {
  useBeforePaint(() => {
    if (ref.current) fitLeaveLabels(ref.current);
  });
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fitLeaveLabels(root));
    observer.observe(root);
    return () => observer.disconnect();
  }, [ref]);
}
