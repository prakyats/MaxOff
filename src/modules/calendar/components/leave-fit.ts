import { type RefObject, useEffect, useLayoutEffect } from "react";

/** A leave label's wordings, chosen by `fitLeaveLabels`. */
export const LEAVE_FIT = "data-leave-fit";

/**
 * On a leave label (`data-leave-fit`): one line, clipped (never an ellipsis), and only the
 * wording its `data-leave-fit` names shown (long until measured): `long`, `short`, `photo` or
 * `face`.
 */
export const LEAVE_FIT_LABEL =
  "overflow-hidden whitespace-nowrap [&[data-leave-fit=short]_[data-leave-word=long]]:hidden [&[data-leave-fit=photo]_[data-leave-word=long]]:hidden [&[data-leave-fit=face]_[data-leave-word=long]]:hidden [&:not([data-leave-fit=short])_[data-leave-word=short]]:hidden [&:not([data-leave-fit=photo])_[data-leave-word=photo]]:hidden [&:not([data-leave-fit=face])_[data-leave-word=face]]:hidden";

/**
 * The wordings in the order they are tried: the first that fits on its one line wins. `face`, the
 * photo alone, is the phone's full month's last rung, where a seventh of the screen has no room
 * even for "[photo] Leave" (the bar's striped leave tone says leave; the box's name says it in
 * words). A label without a rung's span skips it.
 */
const RUNGS = ["long", "short", "photo", "face"] as const;

/**
 * Picks each leave label's wording under `root` (v1.8, owner 23 Oct: a leave bar never truncates
 * to "Prakyat · On l…", and never shows an ellipsis): "Prakyat · On leave" where it fits on its
 * one line, else the short "Prakyat · Leave", else the person's photo and "Leave" (`[photo]
 * Leave`; the box's name still says "Prakyat, on leave"). A label is an element with
 * `data-leave-fit` holding a `data-leave-word="long"`, a `"short"` and, for one person, a
 * `"photo"` span; CSS shows the one its `data-leave-fit` names. All are set long first, then
 * read, then the ones that overflow move one rung down and are read again: the fit is measured,
 * never guessed from a name's length, and happens before paint, so nothing moves.
 */
export function fitLeaveLabels(root: HTMLElement): void {
  let open = [...root.querySelectorAll<HTMLElement>(`[${LEAVE_FIT}]`)];
  for (const label of open) label.setAttribute(LEAVE_FIT, RUNGS[0]);
  for (const rung of RUNGS.slice(1)) {
    open = open.filter(
      (label) =>
        label.scrollWidth > label.clientWidth &&
        label.querySelector(`[data-leave-word="${rung}"]`) !== null,
    );
    if (open.length === 0) return;
    for (const label of open) label.setAttribute(LEAVE_FIT, rung);
  }
}

/** Server-safe layout effect: the label is chosen before the browser paints. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Keeps the leave labels under `ref` fitted (`fitLeaveLabels`): after every render (new days, a
 * new view) and whenever the area changes size (the window, the sidebar). The laptop's month bars
 * and its Week and Day all-day chips, and the phone's full-month bars (owner, #89 comment
 * 6370526089).
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
  useRefitOnFonts(ref, fitLeaveLabels);
}

/**
 * Fits again once the web fonts have loaded: a label measured in the fallback face (a first open,
 * fonts still on their way) is narrower than the same words in the real one, so "Name · Leave"
 * that fitted before the swap would be cut after it, and a font swap resizes no box for the
 * `ResizeObserver` to see (CI run 40022780948: the week's chip at 1280).
 */
function useRefitOnFonts(
  ref: RefObject<HTMLElement | null>,
  fit: (element: HTMLElement) => void,
): void {
  useEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonts) return;
    let live = true;
    const refit = () => {
      if (live && ref.current) fit(ref.current);
    };
    void fonts.ready.then(refit);
    fonts.addEventListener("loadingdone", refit);
    return () => {
      live = false;
      fonts.removeEventListener("loadingdone", refit);
    };
  }, [ref, fit]);
}

/**
 * Keeps the phone header on its one row (option A, owner 23 Oct), trying in turn: `long`; `short`,
 * which turns "Client work ▾" into "Client ▾" (`ShowTrigger`), never an ellipsis; `snug`, the same
 * with no gaps between the 44 px targets; and only where even that would wrap (the narrowest
 * phones, 320 px, or "Client ▾" at 360) `tight`, which also takes the year out of sight ("Oct";
 * the heading's name still says "October 2026"). The row may still wrap at very large system
 * text, where a second line beats anything cut. After every render and on resize.
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
  useRefitOnFonts(ref, fitRow);
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

/** Long, short ("Client ▾"), snug (no gaps), then tight (also "Oct" for "Oct 2026"): the first that fits. */
function fitRow(row: HTMLElement): void {
  for (const fit of ["long", "short", "snug", "tight"]) {
    row.setAttribute("data-fit", fit);
    if (!wraps(row)) return;
  }
}
