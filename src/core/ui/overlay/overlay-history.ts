"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ownHistoryWrite } from "@/core/ui/navigation/history-writes";
import { replaceViewAddress } from "@/core/ui/navigation/view-address";

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
 * the first is 1 → 2, so back closes only the top one. A close that is not a back press (1 → 0)
 * is never popped by `reconcile` itself (see there for the race), so it leaves its entry behind,
 * *spent*, unless the close is one this module knows started no navigation: then the entry is
 * backed out (below, "A layer's own way out backs its entry out"). A spent entry is reused by the
 * next overlay, and `onPopState` skips any that are left.
 *
 * ## The marker must survive Next rewriting `history.state` (found in 2.6)
 *
 * Next's `HistoryUpdater` calls `history.replaceState` with a **fresh** state object after any
 * navigation, refresh or completed server action, and in Next 16 every replace navigation sets
 * `preserveCustomHistoryState: false` (`segment-cache/navigation.js`), so our marker vanished
 * from the entry we had pushed whenever a server action finished while an overlay was open. On
 * My Day the 2.2 day-pass action (a server action answering a second after landing, since
 * replaced by the Start-day prompt) landed exactly when
 * someone tapped Log out: the confirmation's entry lost its marker, `closeOverlaysThen` believed
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
 *
 * ## A layer's own way out backs its entry out (Escape 2026-10-08; buttons, the v3.5 walk)
 *
 * Escape on a laptop is the back gesture's twin (ARCHITECTURE §14.3), and a layer closed by its
 * own button must leave history as back does too (§14.2 a; the owner's v3.5 walk, 26 Nov 2026,
 * steps 8 and 22: "Close" and "Cancel" left the next back doing nothing): no spent entry, and the
 * next back leaves the page. These closes start no navigation, so the race in `reconcile` cannot
 * happen, and their entries *are* backed out. Two kinds, both deterministic (no timer, no guess):
 *
 * - **Dismissals, inside their own event.** Escape (`noteDismiss` from a dialog's or a sheet's
 *   `onEscapeKeyDown`), a click on the layer's way out (`[data-dismiss]`: Cancel, Keep it, Close,
 *   the ✕; never inside a link, `onDismissClick`), a tap on the backdrop (`onPointerDownOutside`)
 *   and a swipe down (`swipe-dismiss.ts`). The close runs inside that same event (Radix closes on
 *   it, React flushes a discrete update before the event ends, and `window.event` is still that
 *   event then), so the layer that unregisters during it is a dismissal (`closingOnDismiss`).
 * - **Commits, after their action.** `useAction` notes the layer on top when a run starts
 *   (`commitLayer`) and, once the action has succeeded, that the run committed there
 *   (`noteCommitted`). If that layer then closes (a confirmation's "Remove Diwali", a form's
 *   Save, which close once the action answered), it is a commit close. The note is forgotten on
 *   the next pointer or key input, on a popstate and on `closeOverlaysThen` / `whenOnPageEntry`
 *   (the app's way to navigate from inside a layer, §14.2 c, which backs out by itself), and a run
 *   that saw one of those three before it answered notes none (`leaveEpoch`: a save that leaves
 *   edit mode through `closeOverlaysThen`). An action that redirects throws, so it never notes a
 *   commit.
 *
 * Either way the spent entries above the layers still open are then backed out, one traversal at
 * a time (`backOutDismissed`): never two in flight (a second back while one is under way is
 * absorbed by the browser), nothing pushed until its popstate has landed, and that popstate
 * closes nothing (`backOutInFlight`). Not while a traversal of ours is under way (`backPending`:
 * `closeOverlaysThen` is already backing out) and not while a navigation is under way
 * (`data-nav-pending`: a link was tapped): then the entry stays spent, as before. A close that
 * kept something else open in its place (a handoff, a dirty form's "Discard?") leaves nothing to
 * back out. An address the screen wrote while the layer was on top (an item sheet dropping its
 * `?item=` on close) is carried down to the entry the back-out lands on (`carriedAddress`).
 *
 * What keeps a spent entry: a close that is none of these (a menu item, a select's pick, a
 * consumer that closes on its own later), and every close while a navigation is under way.
 * Navigation from inside a layer goes through `closeOverlaysThen`, `whenOnPageEntry` or
 * `OverlayLink`, which back out first; a commit must never `router.push` by itself.
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
/**
 * True from a `history.back()` this module started until the next popstate: a traversal is in
 * flight, so `whenOnPageEntry` must not start a second one.
 */
let backPending = false;
let nextId = 0;
/** The event a layer is being dismissed in (`noteDismiss`); compared with `window.event`. */
let dismissEvent: Event | null = null;
/** The pointer, click or key event being dispatched now (`onInput`), for `noteDismiss()`. */
let inputEvent: Event | null = null;
/** A layer closed by its way out or its commit: the spent entries above the open ones go. */
let backOutOwed = false;
/** A `history.back()` started by `backOutDismissed` has not landed: its popstate closes nothing. */
let backOutInFlight = false;
/** The address on top when a back-out began, carried down to where it ends (`carriedAddress`). */
let backOutAddress: string | null = null;
/** The layer a `useAction` run committed on (`noteCommitted`), until it closes or input comes. */
let committedLayer: OpenOverlay | null = null;
/**
 * Counts the moments a commit can no longer be its layer's own close: a popstate, and a
 * navigation from inside a layer (`closeOverlaysThen`, `whenOnPageEntry`). A run that saw one
 * between its start and its answer notes no commit (`noteCommitted`).
 */
let leaveEpoch = 0;

/** A way out of a layer: Cancel, Keep it, Close, the ✕ (a link is never one). */
const DISMISS_SELECTOR = "[data-dismiss]";

function historyState(): Record<string, unknown> {
  return (window.history.state ?? {}) as Record<string, unknown>;
}

function address(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * `progress.ts`'s `NAV_PENDING_ATTRIBUTE`, written out: importing that module would put all of
 * it in every route's first load (`overlay-history.test.ts` pins the two together).
 */
export const NAV_PENDING = "data-nav-pending";

/** A link was tapped or the router is fetching another screen (`progress.ts`). */
function navigating(): boolean {
  return document.documentElement.hasAttribute(NAV_PENDING);
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
  // A dismissal's back-out is landing: nothing moves until its popstate reconciles again.
  if (backOutInFlight) return;

  // `pushedCount` means "entries above the page we are on". A navigation buries ours: leaving a
  // page from inside an overlay (tapping People in the More sheet) puts a fresh entry on top of
  // our spent one, and without this the count stayed high and the *next* overlay pushed nothing
  // — so on /people the detail sheet had no entry and back navigated instead of closing it.
  // The current entry carrying no marker is the proof that whatever we pushed is behind us.
  if (historyState()[MARKER] === undefined) pushedCount = 0;
  // Only ever pushes. Popping here would race a navigation started from inside the overlay: a
  // link in the More sheet closes the sheet and begins a transition in the same tick, and a
  // popstate arriving mid-transition makes Next abandon it — the tap did nothing and the user
  // stayed put (measured, not theorised). An overlay closed some other way therefore leaves its
  // entry behind as *spent*, and `onPopState` skips past it, unless its close was a dismissal
  // or a commit (`backOutDismissed`, see the header).
  //
  // A spent entry is reused: reopening an overlay finds `pushedCount` already high enough and
  // pushes nothing, so repeated open/close cannot pile up entries.
  if (pushedCount < open.length) {
    // Something opened in the closed one's place: its entry is reused, nothing to back out.
    backOutOwed = false;
    carryAddressDown();
    pushedCount += 1;
    const entry = { ...historyState(), [MARKER]: ++nextId };
    ownHistoryWrite(() => window.history.pushState(entry, ""));
    schedule();
    return;
  }
  backOutDismissed();
}

/**
 * The one exception to "never pop": the spent entries left by a layer closed by its own way out
 * or its commit (see the header). One traversal at a time, each over an entry of ours with an
 * overlay-less count beneath it, until the count matches the layers still open.
 */
function backOutDismissed(): void {
  if (!backOutOwed) return;
  if (
    shouldBackOut({
      pushedCount,
      openCount: open.length,
      onOwnEntry: historyState()[MARKER] !== undefined,
      backPending,
      navigating: navigating(),
    })
  ) {
    backOutAddress ??= address();
    backOutInFlight = true;
    backPending = true;
    window.history.back();
    return;
  }
  // Done, or nothing of ours to back out (a handoff kept the count, a traversal or a navigation
  // is under way).
  backOutOwed = false;
  carryAddressDown();
}

/**
 * Whether a spent entry is backed out now, once a dismissal or a commit owes it: there is a spent
 * entry of ours on top (more entries than open overlays, and the current one is marked), no
 * traversal is in flight and no navigation is under way. Pure, so the rule is unit-tested.
 */
export function shouldBackOut(state: {
  pushedCount: number;
  openCount: number;
  onOwnEntry: boolean;
  backPending: boolean;
  navigating: boolean;
}): boolean {
  return (
    state.pushedCount > state.openCount &&
    state.onOwnEntry &&
    !state.backPending &&
    !state.navigating
  );
}

/**
 * The address to write on the entry a back-out landed on: the one the screen showed on top
 * (`left`, written while the layer was open or as it closed, e.g. an item sheet dropping
 * `?item=`), when it differs from where it landed on the same screen; else none. Pure.
 */
export function carriedAddress(left: string | null, landed: string): string | null {
  if (left === null || left === landed) return null;
  const path = (value: string) => value.split(/[?#]/, 1)[0];
  return path(left) === path(landed) ? left : null;
}

function carryAddressDown(): void {
  const left = backOutAddress;
  backOutAddress = null;
  const carried = carriedAddress(left, address());
  if (carried !== null) replaceViewAddress(carried);
}

/**
 * The layer that closes during the event being dispatched now (`event`, or else the pointer,
 * click or key event under way) is being dismissed: its entry is backed out, as the back gesture
 * would have (§14.2 a, §14.3). Called by `Dialog`, `AlertDialog` and `Sheet` on Escape and on a
 * tap outside (after the caller's own handler let it through), by the swipe-down, and by the
 * click listener for a way out (`[data-dismiss]`).
 */
export function noteDismiss(event?: Event): void {
  dismissEvent = event ?? inputEvent;
}

/** The overlay closing now is closing on a noted dismissal (still inside that event). */
function closingOnDismiss(): boolean {
  return (
    dismissEvent !== null &&
    typeof window !== "undefined" &&
    (window as Window & { event?: Event }).event === dismissEvent
  );
}

/** A click on a layer's way out (`[data-dismiss]`), never inside a link: a dismissal. */
function onDismissClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const control = target?.closest(DISMISS_SELECTOR);
  if (!control || control.closest("a[href]")) return;
  noteDismiss(event);
}

/** Pointer and key input, heard first (window, capture): the event under way; a commit is over. */
function onInput(event: Event): void {
  inputEvent = event;
  if (event.type !== "click") committedLayer = null;
}

/** An opaque handle on the layer a `useAction` run started on, and when. */
export type CommitLayer = {
  readonly layer: { readonly id: number } | null;
  readonly epoch: number;
};

/** The layer on top now (a `useAction` run starting from it; null with none open). */
export function commitLayer(): CommitLayer {
  return { layer: open[open.length - 1] ?? null, epoch: leaveEpoch };
}

/**
 * A `useAction` run that started on `layer` has succeeded: if that layer now closes (the commit
 * closes it once the action answered), its entry is backed out. Forgotten on the next pointer or
 * key input, on a popstate and when a navigation from inside a layer begins.
 */
export function noteCommitted({ layer, epoch }: CommitLayer): void {
  // A back press or a navigation from the layer came first (a save that left edit mode through
  // `closeOverlaysThen`): that one backs out, the commit does not.
  committedLayer = epoch === leaveEpoch ? (open.find((entry) => entry === layer) ?? null) : null;
}

/**
 * Works from where the browser landed rather than from a running count, so it is self-correcting
 * after anything unexpected — a reload, a navigation, a back press we did not cause.
 */
function onPopState(): void {
  backPending = false;
  committedLayer = null;
  leaveEpoch += 1;
  if (backOutInFlight) {
    // Our own back-out of a dismissed layer's entry landed: it closes nothing (that layer is
    // closed). `reconcile` goes on to the next spent entry, if one is owed.
    backOutInFlight = false;
    pushedCount = historyState()[MARKER] === undefined ? 0 : Math.max(0, pushedCount - 1);
    schedule();
    return;
  }
  // A back press of the person's own: whatever was owed is theirs now.
  backOutOwed = false;
  backOutAddress = null;
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
    backPending = true;
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
  // Capture on window: heard before any handler in the app (React's own listeners included).
  for (const type of ["pointerdown", "pointerup", "click", "keydown"]) {
    window.addEventListener(type, onInput, true);
  }
  window.addEventListener("click", onDismissClick, true);
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
const closeThen = createCloseOverlaysThen({
  ownsTopEntry: () =>
    typeof window !== "undefined" && pushedCount > 0 && historyState()[MARKER] !== undefined,
  back: () => {
    backPending = true;
    window.history.back();
  },
  onNextPopState: (callback) => {
    const listener = () => callback();
    window.addEventListener("popstate", listener, { once: true });
    return () => window.removeEventListener("popstate", listener);
  },
});

/**
 * The app's instance of `createCloseOverlaysThen`. A navigation from inside a layer begins here,
 * so a commit noted on that layer is over: it backs out by itself (no second traversal).
 */
export function closeOverlaysThen(fn: () => void): boolean {
  committedLayer = null;
  leaveEpoch += 1;
  return closeThen(fn);
}

/**
 * Whether any overlay (a dialog, a sheet, a menu, a select's list) is open: a page's keyboard
 * shortcuts stay quiet while one is (the laptop calendar's).
 */
export function hasOpenOverlay(): boolean {
  return open.length > 0;
}

/** The browser side of `whenOnPageEntry`, injectable so the logic is unit-tested. */
export interface PageEntryEnv {
  /** True when the current history entry is the page's own: it carries no overlay marker. */
  onPageEntry: () => boolean;
  /** True while a `history.back()` started here has not yet landed. */
  backPending: () => boolean;
  back: () => void;
  /** Calls `callback` on every popstate until the returned unsubscribe is called. */
  onPopState: (callback: () => void) => () => void;
  /** The current address's path (`location.pathname`). */
  pathname: () => string;
}

/**
 * Runs `fn` once history has landed on the **page's own entry** (no overlay marker), for a
 * caller that rewrites the page's address after its overlays closed (the calendar's filters
 * and "Open day", ARCHITECTURE §14.2 d).
 *
 * `closeOverlaysThen` backs out the top entry only. An overlay that opened another one over it
 * (a select's sheet inside the filters sheet) leaves spent entries below, and `onPopState`
 * steps over them one popstate at a time. A `router.replace` that ran before the last step
 * landed was undone by it: Next restored the page entry's old address (the filters were lost).
 * So this waits, popstate by popstate, until the current entry is unmarked; it steps back itself
 * only when no traversal is in flight (never two at once, never on a timer). `fn` runs once.
 * Use it with every overlay closed: a marked entry here is spent, never a live layer.
 *
 * The overlays' entries share the page's path, so a popstate on another path means the person
 * went elsewhere meanwhile: it stops listening there and `fn` never runs (it must not rewrite the
 * page's address from another screen).
 */
export function createWhenOnPageEntry(env: PageEntryEnv): (fn: () => void) => void {
  return (fn) => {
    if (env.onPageEntry()) {
      fn();
      return;
    }
    const path = env.pathname();
    const step = () => {
      if (!env.backPending()) env.back();
    };
    const unsubscribe = env.onPopState(() => {
      if (env.pathname() !== path) {
        unsubscribe();
        return;
      }
      if (!env.onPageEntry()) {
        step();
        return;
      }
      unsubscribe();
      fn();
    });
    step();
  };
}

/**
 * The app's instance; its listener runs after the controller's own `onPopState`. It forgets a
 * noted commit, as `closeOverlaysThen` does.
 */
export function whenOnPageEntry(fn: () => void): void {
  committedLayer = null;
  leaveEpoch += 1;
  pageEntryThen(fn);
}

const pageEntryThen = createWhenOnPageEntry({
  onPageEntry: () => typeof window === "undefined" || historyState()[MARKER] === undefined,
  backPending: () => backPending,
  back: () => {
    backPending = true;
    window.history.back();
  },
  onPopState: (callback) => {
    const listener = () => callback();
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  },
  pathname: () => (typeof window === "undefined" ? "" : window.location.pathname),
});

/**
 * Makes one overlay dismissible with the back gesture. `onClose` must close it; it is read
 * through a ref, so an inline arrow function will not re-run the effect.
 */
export function useOverlayHistory(isOpen: boolean, onClose: () => void): { isTop: () => boolean } {
  const onCloseRef = useRef(onClose);
  const entryRef = useRef<OpenOverlay | null>(null);
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
        ownHistoryWrite(() => window.history.replaceState(cleaned, ""));
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
    entryRef.current = entry;
    schedule();

    return () => {
      // `onPopState` may already have removed it; removing by identity keeps that idempotent.
      const at = open.indexOf(entry);
      if (at !== -1) {
        open.splice(at, 1);
        // Closed by its way out or its commit: its entry is backed out once the commit settles
        // (`reconcile`), unless something opened in its place.
        if (closingOnDismiss() || committedLayer === entry) backOutOwed = true;
      }
      if (committedLayer === entry) committedLayer = null;
      if (entryRef.current === entry) entryRef.current = null;
      schedule();
    };
  }, [isOpen]);

  // Whether this overlay is the top layer now (it owns the next back press and the next Escape).
  return {
    isTop: useCallback(() => {
      const entry = entryRef.current;
      return entry !== null && open[open.length - 1] === entry;
    }, []),
  };
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
