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

function startListening(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", onPopState);
}

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
      window.history.replaceState(cleaned, "");
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
