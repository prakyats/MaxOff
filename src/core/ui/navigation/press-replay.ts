/**
 * A press the page swapped out from under the pointer (fix-held-press-back, 26 Nov 2026; the
 * follow-up of fix-stable-back).
 *
 * Next swaps a route's `loading.tsx` for its page, and a Suspense fallback for what it waited for,
 * by replacing elements. A back control (or a view control, a tab, the bell) drawn by the loading
 * screen is a new element once the page streams in. A **mouse** press that goes down on the old
 * one and comes up on the new one fires no click at all: the browser sees two different elements,
 * and the tap is lost (found by CI 45754758589 on the person page; Chromium, checked by hand). A
 * touch tap is answered at the finger's last place, so it lands; this repairs the mouse case and
 * guards every kind of press against a double move.
 *
 * The head script (`pre-hydration.ts`) stays on the document after hydration, so it repairs the
 * press before hydration and after it, on every screen: it remembers the enhanced link a press
 * went down on and, when the press comes up on a replacement of it, clicks the replacement, unless
 * the browser's own click reaches it first. This function is the decision, and only the decision;
 * self-contained on purpose (no imports, no outer names): the script carries its source.
 */

/** One end of a press, read from the pointer event and the enhanced link under it. */
export interface PressEnd {
  /** The pointer event's `button`: 0 is the primary button (and a touch, and a pen's tip). */
  button: number;
  /** Ctrl, ⌘, Shift or Alt was held: a new tab, a new window or a download, never ours. */
  modified: boolean;
  /**
   * The enhanced link's kind (`back`, `view`, `tab`, `bell`); null for anything else: an ordinary
   * link, a button, a field.
   */
  kind: string | null;
  href: string;
  /**
   * The link opens elsewhere (another target, a download) or sits where a replayed press would be
   * a write (`NEVER_HELD`: a form, a commit footer).
   */
  excluded: boolean;
}

/** How long a touch or pen press waits for the browser's own click before it is replayed. */
export const PRESS_REPLAY_WAIT_MS = 350;

/**
 * Whether a press that went down on `down` and came up on `up` is replayed as one click on the
 * link under `up`. Only the primary button with no modifier key, at both ends; only an enhanced
 * link, the same kind and the same address at both ends, never an excluded one; and only when the
 * link the press went down on has left the page (`pressedConnected` false): otherwise the browser
 * answers the press itself.
 */
export function replaysPress(
  down: PressEnd | null,
  up: PressEnd | null,
  pressedConnected: boolean,
): boolean {
  if (!down || !up) return false;
  if (pressedConnected) return false;
  if (down.button !== 0 || up.button !== 0) return false;
  if (down.modified || up.modified) return false;
  if (down.kind === null || up.kind !== down.kind) return false;
  if (up.href !== down.href) return false;
  return !down.excluded && !up.excluded;
}
