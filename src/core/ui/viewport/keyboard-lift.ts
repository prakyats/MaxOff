"use client";

import { type Ref, type RefCallback, useCallback } from "react";

import { isKeyboardOpen, keyboardState, type VisualViewportLike } from "./keyboard";

/**
 * **A bottom sheet follows the on-screen keyboard** (owner's phone walk of phase 7, 2026-10-09:
 * the keyboard opened over the "Item list" sheet, "Add a stage" and the item's editor and hid
 * the field being typed in). The app keeps the browsers' default `interactive-widget`
 * (`resizes-visual`): the keyboard shrinks only the **visual** viewport, so a `fixed; bottom: 0`
 * sheet stays at the layout bottom, behind it, and Radix's scroll lock leaves nothing to scroll.
 * `resizes-content` would lift it on Android only (iOS ignores it) and would also lift the
 * bottom bar and every docked bar over the keyboard, undoing decision 32 (a page's bar steps
 * aside while typing). So each bottom-docked layer measures `visualViewport` itself
 * (`keyboard.ts`, as the task's Chat sheet does): while the keyboard is open the layer ends
 * where the keyboard begins and is never taller than what is still visible, and the focused
 * field is scrolled into the layer's visible part.
 *
 * Wired in the primitives (`Sheet` side bottom, `Dialog` and `AlertDialog` below `md`, where they
 * are bottom sheets), so every sheet in the app gets it. Plain DOM, no re-render: the listeners
 * write the layer's inline `bottom` and `max-height` and take them away when the keyboard closes
 * or the layer unmounts.
 */

/** Room kept above the lifted layer, so its top edge and handle stay visible. */
export const KEYBOARD_LIFT_GAP = 8;

/** What a bottom layer needs from `visualViewport`: its size, offset and pinch-zoom scale. */
export type LiftViewport = VisualViewportLike & { scale?: number };

/** Where the layer goes while the keyboard is open, in CSS px. */
export type KeyboardLift = { bottom: number; maxHeight: number };

/**
 * The lift, or null to leave the layer where its CSS puts it: no visual viewport, the keyboard
 * closed, or the page pinch-zoomed (a zoomed visual viewport is smaller than the layout one
 * without any keyboard). `ownMaxHeight` is the layer's own cap (its `max-h-[85dvh]`), in px, or
 * null when it has none: the lift never makes a layer taller than its CSS allows.
 */
export function keyboardLift(
  layoutHeight: number,
  viewport: LiftViewport | null | undefined,
  ownMaxHeight: number | null,
): KeyboardLift | null {
  if (!viewport) return null;
  if (Math.abs((viewport.scale ?? 1) - 1) > 0.01) return null;
  const state = keyboardState(layoutHeight, viewport);
  if (!isKeyboardOpen(state)) return null;
  const visible = Math.max(0, state.height - KEYBOARD_LIFT_GAP);
  return {
    bottom: state.inset,
    maxHeight: ownMaxHeight === null ? visible : Math.min(ownMaxHeight, visible),
  };
}

const DESKTOP = "(min-width: 768px)";

const NOT_TYPED = new Set([
  "button",
  "checkbox",
  "radio",
  "submit",
  "reset",
  "file",
  "range",
  "color",
]);

/** A control the keyboard types into: what the lift scrolls into view. */
export function isTextField(element: Element | null): element is HTMLElement {
  if (!element) return false;
  if ((element as HTMLElement).isContentEditable || element.tagName === "TEXTAREA") return true;
  return element.tagName === "INPUT" && !NOT_TYPED.has((element as HTMLInputElement).type);
}

/**
 * Makes `layer` follow the keyboard until the returned function is called. `phoneOnly`: the layer
 * is a bottom sheet only below `md` (a dialog), so from `md` up it is left alone.
 */
export function followKeyboard(layer: HTMLElement, { phoneOnly }: { phoneOnly: boolean }) {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  let lifted = false;
  let frame = 0;
  // The layer's own cap (its `max-h-[85dvh]`), read without the lift's once per lift: `dvh`
  // does not follow the keyboard, so it holds until the window itself resizes.
  let own: number | null | undefined;

  const reveal = (field: Element | null) => {
    if (!lifted || !isTextField(field) || !layer.contains(field)) return;
    cancelAnimationFrame(frame);
    // After the frame that moved the layer, so the field is measured where it now is.
    frame = requestAnimationFrame(() => field.scrollIntoView({ block: "nearest" }));
  };

  const drop = () => {
    if (!lifted) return;
    lifted = false;
    own = undefined;
    layer.style.removeProperty("bottom");
    layer.style.removeProperty("max-height");
    layer.removeAttribute("data-keyboard");
  };

  const ownCap = () => {
    if (own === undefined) {
      layer.style.removeProperty("max-height");
      const css = Number.parseFloat(getComputedStyle(layer).maxHeight);
      own = Number.isFinite(css) ? css : null;
    }
    return own;
  };

  const place = () => {
    if (phoneOnly && window.matchMedia(DESKTOP).matches) return drop();
    // Measured without the cap first, so a closed keyboard never reads the layer's style.
    if (!keyboardLift(window.innerHeight, viewport, null)) return drop();
    const lift = keyboardLift(window.innerHeight, viewport, ownCap());
    if (!lift) return drop();
    const bottom = `${lift.bottom}px`;
    const maxHeight = `${lift.maxHeight}px`;
    if (lifted && layer.style.bottom === bottom && layer.style.maxHeight === maxHeight) return;
    lifted = true;
    layer.style.bottom = bottom;
    layer.style.maxHeight = maxHeight;
    layer.setAttribute("data-keyboard", "open");
    reveal(document.activeElement);
  };

  const onResize = () => {
    own = undefined;
    place();
  };

  const onFocus = (event: FocusEvent) => reveal(event.target as Element | null);

  viewport.addEventListener("resize", place);
  viewport.addEventListener("scroll", place);
  window.addEventListener("resize", onResize);
  layer.addEventListener("focusin", onFocus);
  place();
  return () => {
    viewport.removeEventListener("resize", place);
    viewport.removeEventListener("scroll", place);
    window.removeEventListener("resize", onResize);
    layer.removeEventListener("focusin", onFocus);
    cancelAnimationFrame(frame);
    drop();
  };
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * The ref a primitive's content takes to follow the keyboard (`followKeyboard`), passing the
 * element on to the caller's own `ref`. Off (`enabled` false): only the caller's ref.
 */
export function useKeyboardLift<T extends HTMLElement>(
  enabled: boolean,
  phoneOnly: boolean,
  forwarded?: Ref<T>,
): RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      assignRef(forwarded, node);
      const stop = node && enabled ? followKeyboard(node, { phoneOnly }) : null;
      return () => {
        stop?.();
        assignRef(forwarded, null);
      };
    },
    [enabled, phoneOnly, forwarded],
  );
}
