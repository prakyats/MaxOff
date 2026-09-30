/**
 * The on-screen keyboard, measured (Kickoff 4 decision 32). Chrome on Android and Safari on iOS
 * resize only the **visual** viewport when the keyboard opens: the layout viewport keeps its
 * height, so a `fixed; bottom: 0` element stays at the layout bottom, behind the keyboard.
 * `window.visualViewport` says what is still visible; the difference at the bottom is the
 * keyboard. Pure, so the arithmetic is unit-tested; `use-keyboard.ts` feeds it real events.
 */

/** What `window.visualViewport` reports that matters here. */
export type VisualViewportLike = { height: number; offsetTop: number };

/** The visible area and the keyboard over the layout viewport's bottom, in CSS px. */
export type KeyboardState = {
  /** How far the keyboard covers the layout viewport's bottom (0 when closed). */
  inset: number;
  /** The visible height (the layout height when there is no visual viewport). */
  height: number;
};

/**
 * A keyboard is taller than anything else that shrinks the visual viewport (a browser's own
 * bars, a pinch-zoom's rounding): below this it is not open.
 */
export const KEYBOARD_OPEN_PX = 120;

export function keyboardState(
  layoutHeight: number,
  viewport: VisualViewportLike | null | undefined,
): KeyboardState {
  if (!viewport) return { inset: 0, height: layoutHeight };
  const inset = Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
  return { inset, height: Math.round(viewport.height) };
}

export function isKeyboardOpen(state: KeyboardState): boolean {
  return state.inset >= KEYBOARD_OPEN_PX;
}
