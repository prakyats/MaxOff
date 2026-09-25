"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Back closes the overlay, not the page (task 1.5, ARCHITECTURE §14.1).
 *
 * On a phone the back gesture is how you dismiss things. Without this, swiping back with the
 * More sheet open navigates the page underneath and the sheet is still there — the clearest
 * "this is a website, not an app" tell left in the shell. Applied on desktop too: the browser
 * back button then does the same thing, which costs nothing and surprises nobody.
 *
 * ## How it works with the Next App Router
 *
 * An open overlay is backed by a history entry carrying a marker, pushed with **no URL** — the
 * address bar never changes, so no route work happens and `usePathname` is untouched. Next
 * patches `window.history.pushState` and copies `__NA` and `__PRIVATE_NEXTJS_INTERNALS_TREE`
 * onto whatever state we pass. That matters: Next's own `popstate` handler calls
 * `window.location.reload()` for any entry without `__NA`, so a hand-rolled push that dropped it
 * would turn every back press into a full page reload. Passing no `url` also skips Next's
 * `ACTION_RESTORE` dispatch. Both behaviours are pinned in `overlay-history.test.ts`.
 *
 * ## Why one controller instead of one effect per overlay
 *
 * The obvious shape — each overlay pushes on open and calls `history.back()` on close — breaks
 * on **handoff**, which the app really does: tapping Deactivate in a detail sheet closes the
 * sheet and opens a confirm dialog in the same commit. `history.back()` is asynchronous, so the
 * closing sheet's back arrived *after* the opening dialog had pushed its entry and swallowed it,
 * and the dialog vanished on open.
 *
 * So nothing pushes or pops directly. Overlays register themselves, and a microtask reconciles
 * the number of history entries against the number of open overlays. A handoff is 1 → 0 → 1
 * within one commit, which settles at 1: no history change at all. Opening a second overlay over
 * the first is 1 → 2, so back closes only the top one. Closing by button, backdrop or Escape is
 * 1 → 0 leaves its entry behind, spent: see `reconcile` for why it cannot be popped there. The
 * entry is reused by the next overlay, and `onPopState` skips any that are left, so the visible
 * cost is one back press that lands on the same page after dismissing an overlay by hand.
 *
 * ## The marker must survive Next rewriting `history.state` (found in 2.6)
 *
 * Next's `HistoryUpdater` calls `history.replaceState` with a **fresh** state object after any
 * navigation, refresh or completed server action, and in Next 16 every replace navigation sets
 * `preserveCustomHistoryState: false` (`segment-cache/navigation.js`), so our marker vanished
 * from the entry we had pushed whenever a server action finished while an overlay was open. On
 * My Day the day-pass action (`<IssueDayPass />`) answers a second after landing, exactly when
 * someone taps Log out: the confirmation's entry lost its marker, `closeOverlaysThen` believed
 * nothing was on top and navigated at once, and the redirect replaced the overlay's entry with
 * /login, leaving My Day underneath (`back-gesture.spec.ts` "logout", 8 of 23 runs). So
 * `replaceState` is wrapped once (`guardMarker`): an entry that carries the marker keeps it
 * through any replace, because a replace never changes *which* entry it is. `pushState` is not
 * touched: a new entry is a new page and starts unmarked, as before.
 *
 * ## The one rough edge
 *
 * `history.state` survives a reload but React state does not. Refresh with an overlay open and
 * the browser restores our marked entry while the overlay comes back closed. The marker is
 * stripped on mount so our bookkeeping stays honest, but the *entry* cannot be removed without
 * navigating, so the first back press after such a refresh is absorbed doing nothing visible.
 * That costs one extra press in a case nobody hits on purpose; the alternative is calling
 * `history.back()` during hydration, which can throw the user off the page entirely.
 */

const MARKER = "maxoffOverlay";
/** Tags the wrapped `replaceState`, so the guard is installed once per document. */
const GUARDED = Symbol.for("maxoff.overlay.guard");

interface OpenOverlay {
  id: number;
  close: () => void;
}

/** Open overlays, oldest first. The last one owns the next back press. */
const open: OpenOverlay[] = [];
/** History entries we are responsible for. Reconciled towards `open.length`. */
let pushedCount = 0;
let reconcileQueued = false;
let listening = false;
let nextId = 0;

function historyState(): Record<string, unknown> {
  return (window.history.state ?? {}) as Record<string, unknown>;
}

function schedule(): void {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(reconcile);
}

/**
 * Brings the number of pushed entries in line with the number of open overlays. Runs after the
 * commit has settled, so a close and an open in the same commit cancel out instead of racing.
 */
function reconcile(): void {
  reconcileQueued = false;

  // `pushedCount` means "entries above the page we are on". A navigation buries ours: leaving a
  // page from inside an overlay (tapping People in the More sheet) puts a fresh entry on top of
  // our spent one, and without this the count stayed high and the *next* overlay pushed nothing
  // — so on /people the detail sheet had no entry and back navigated instead of closing it.
  // The current entry carrying no marker is the proof that whatever we pushed is behind us.
  if (historyState()[MARKER] === undefined) pushedCount = 0;
  // Only ever pushes. Popping here would race a navigation started from inside the overlay: a
  // link in the More sheet closes the sheet and begins a transition in the same tick, and a
  // popstate arriving mid-transition makes Next abandon it — the tap did nothing and the user
  // stayed put (measured, not theorised). An overlay closed by button, backdrop or Escape
  // therefore leaves its entry behind as *spent*, and `onPopState` skips past it.
  //
  // A spent entry is reused: reopening an overlay finds `pushedCount` already high enough and
  // pushes nothing, so repeated open/close cannot pile up entries.
  if (pushedCount < open.length) {
    pushedCount += 1;
    window.history.pushState({ ...historyState(), [MARKER]: ++nextId }, "");
    schedule();
  }
}

/**
 * Works from where the browser landed rather than from a running count, so it is self-correcting
 * after anything unexpected — a reload, a navigation, a back press we did not cause.
 */
function onPopState(): void {
  if (open.length > 0) {
    // Backing out of a live overlay: close the topmost one and leave the rest alone.
    const top = open.pop();
    top?.close();
    pushedCount = open.length;
    return;
  }

  if (historyState()[MARKER] !== undefined) {
    // A spent entry from an overlay that was dismissed some other way. Nothing to show here, so
    // keep going rather than making the press look ignored.
    window.history.back();
    return;
  }

  // A real page entry: whatever we were tracking is gone.
  pushedCount = 0;
}

/**
 * The state a `replaceState` should write: `next`, plus the marker when the entry being
 * replaced carries one and `next` does not. Pure, so the rule is unit-tested on its own.
 */
export function keepMarker(current: unknown, next: unknown): unknown {
  if (!isRecord(current) || current[MARKER] === undefined) return next;
  if (next !== null && next !== undefined && !isRecord(next)) return next;
  if (isRecord(next) && next[MARKER] !== undefined) return next;
  return { ...(next ?? {}), [MARKER]: current[MARKER] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Whether the guard is bypassed: the one caller that means to drop the marker sets this. */
let stripping = false;

/**
 * Wraps whatever `history.replaceState` is at that moment (Next's own patch, once the router
 * has mounted) so the marker survives Next's rewrites. Idempotent per document.
 */
function guardMarker(): void {
  const history = window.history as History & {
    replaceState: History["replaceState"] & { [GUARDED]?: true };
  };
  if (history.replaceState[GUARDED]) return;
  const inner = history.replaceState;
  const guarded: History["replaceState"] & { [GUARDED]?: true } = function replaceState(
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    return inner.call(this, stripping ? data : keepMarker(this.state, data), unused, url);
  };
  guarded[GUARDED] = true;
  history.replaceState = guarded;
}

function startListening(): void {
  if (typeof window === "undefined") return;
  guardMarker();
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", onPopState);
}

/** The browser side of `closeOverlaysThen`, injectable so the logic is unit-tested. */
export interface CloseThenEnv {
  /**
   * True only when the controller knows the current history entry is one it pushed: an entry
   * of its own, marked, with a real page beneath it. Then `history.back()` is a same-document
   * traversal to that page and its popstate is guaranteed.
   */
  ownsTopEntry: () => boolean;
  back: () => void;
  /** Calls `callback` on the next popstate; returns the unsubscribe. */
  onNextPopState: (callback: () => void) => () => void;
}

/**
 * Runs `fn` once the overlay entry on top of the page is gone (ARCHITECTURE §14.2 c, e).
 *
 * A link inside an overlay that navigates to a **tab root** (the More sheet), and a server
 * action that redirects from inside a confirmation (Log out), must not leave the overlay's entry
 * under the new page, or back would stop there. So it goes back past the entry first and runs
 * `fn` only once that popstate has arrived — never both at once, which is the race `reconcile`
 * describes. It backs out **only when it owns the top entry**, which makes the popstate certain,
 * so there is no timer: a fallback that could fire while the traversal was still in flight was
 * the 2.6 logout bug's second half (the redirect then replaced the overlay's entry). When it
 * owns nothing, `fn` runs at once. A second call while one is under way (a fast double tap) is
 * ignored and returns false; `fn` runs at most once.
 */
export function createCloseOverlaysThen(env: CloseThenEnv): (fn: () => void) => boolean {
  let pending = false;
  return (fn) => {
    if (pending) return false;
    if (!env.ownsTopEntry()) {
      fn();
      return true;
    }
    pending = true;
    const unsubscribe = env.onNextPopState(() => {
      pending = false;
      unsubscribe();
      fn();
    });
    env.back();
    return true;
  };
}

/**
 * The app's instance. Its popstate listener is added after the controller's own (`onPopState`
 * starts listening when the first overlay opens), so by the time `fn` runs the overlay has
 * been closed and the bookkeeping reset.
 */
export const closeOverlaysThen = createCloseOverlaysThen({
  ownsTopEntry: () =>
    typeof window !== "undefined" && pushedCount > 0 && historyState()[MARKER] !== undefined,
  back: () => window.history.back(),
  onNextPopState: (callback) => {
    const listener = () => callback();
    window.addEventListener("popstate", listener, { once: true });
    return () => window.removeEventListener("popstate", listener);
  },
});

/**
 * Makes one overlay dismissible with the back gesture. `onClose` must close it; it is read
 * through a ref, so an inline arrow function will not re-run the effect.
 */
export function useOverlayHistory(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  // Assigned in an effect, not during render: the controller only ever calls it from popstate.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // A marker left behind by a reload would otherwise make the first back press look like ours.
  useEffect(() => {
    if (open.length === 0 && pushedCount === 0 && historyState()[MARKER] !== undefined) {
      const cleaned = { ...historyState() };
      delete cleaned[MARKER];
      // The one replace that means to drop the marker: the guard must let it through.
      stripping = true;
      try {
        window.history.replaceState(cleaned, "");
      } finally {
        stripping = false;
      }
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    startListening();

    const entry: OpenOverlay = { id: ++nextId, close: () => onCloseRef.current() };
    open.push(entry);
    schedule();

    return () => {
      // `onPopState` may already have removed it; removing by identity keeps that idempotent.
      const at = open.indexOf(entry);
      if (at !== -1) open.splice(at, 1);
      schedule();
    };
  }, [isOpen]);
}

/**
 * Radix roots accept controlled `open`, uncontrolled `defaultOpen`, or neither. This normalises
 * all three into one `[open, setOpen]` so the primitives can hand a real boolean to
 * `useOverlayHistory` without forcing every call site to become controlled.
 */
export function useOverlayOpenState({
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
}: {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((next: boolean) => void) | undefined;
}): [boolean, (next: boolean) => void] {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen ?? false);
  const isControlled = controlledOpen !== undefined;
  const value = isControlled ? controlledOpen : uncontrolled;

  const setValue = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  useOverlayHistory(
    value,
    useCallback(() => setValue(false), [setValue]),
  );

  return [value, setValue];
}
