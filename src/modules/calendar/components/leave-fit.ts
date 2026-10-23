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

/**
 * Keeps the phone header on its one row (option A, owner 23 Oct): `data-fit="long"` first, and
 * `data-fit="short"` when the row would wrap, which turns "Client work ▾" into "Client ▾"
 * (`ShowTrigger`), never an ellipsis; at the narrowest phones (320 px) `data-fit="tight"` also
 * drops the gaps and the month's year from sight ("Oct"; its name still says "October 2026"). The row may still wrap at very large system text, where a
 * second line beats anything cut. After every render and on resize.
 */
export function useHeaderFit(ref: RefObject<HTMLElement | null>): void {
  useBeforePaint(() => {
    if (ref.current) fitRow(ref.current);
  });
  useEffect(() => {
    const row = ref.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fitRow(row));
    observer.observe(row);
    return () => observer.disconnect();
  }, [ref]);
}

/** Whether a wrapping row's parts sit on more than one line (or push past its edge). */
function wraps(row: HTMLElement): boolean {
  const parts = [...row.children] as HTMLElement[];
  // The first line ends at its tallest part's bottom (the parts are centred, so their tops differ).
  const first = parts[0];
  if (!first) return false;
  const lineEnd = first.offsetTop + first.offsetHeight;
  return row.scrollWidth > row.clientWidth || parts.some((part) => part.offsetTop >= lineEnd);
}

/** Long, then short ("Client ▾"), then tight (also "Oct" for "Oct 2026", no gaps): the first that fits. */
function fitRow(row: HTMLElement): void {
  for (const fit of ["long", "short", "tight"]) {
    row.setAttribute("data-fit", fit);
    if (!wraps(row)) return;
  }
}
