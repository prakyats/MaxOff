"use client";

import * as React from "react";

import { noteEscape } from "@/core/ui/overlay/overlay-history";

import { firstField } from "./dom";
import { isComposing } from "./keys";
import { finePointer } from "./pointer";

/**
 * What `Dialog`, `AlertDialog` and `Sheet` do with Escape and with their opening focus
 * (ARCHITECTURE §14.3 rules 4 and 5), so every overlay in the app follows them.
 */

/**
 * Escape on an open dialog or sheet. The caller's own handler runs first and may keep it open
 * (`preventDefault`). It also stays open while an IME is composing (Escape cancels the
 * composition) and while a search box inside it still has text (Escape clears the box first,
 * rule 6). Otherwise it closes as the back gesture would: its history entry is backed out.
 */
export function onLayerEscape(
  event: KeyboardEvent,
  callerHandler: ((event: KeyboardEvent) => void) | undefined,
): void {
  callerHandler?.(event);
  if (event.defaultPrevented) return;
  if (isComposing(event) || clearsItself(event.target)) {
    event.preventDefault();
    return;
  }
  noteEscape(event);
}

/** A search box with text: its own Escape empties it (the table's search, rule 6). */
function clearsItself(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === "search" && target.value !== "";
}

/**
 * Where focus goes when a dialog or sheet opens (rule 5). The caller's own handler runs first
 * and may take it (`preventDefault`: the select's list focuses its chosen row). On a laptop the
 * first field takes focus, so typing starts at once; with no field, Radix's own choice stands.
 * On touch nothing that opens the keyboard is focused: the surface itself takes focus, which
 * keeps the focus trap and the screen reader inside it.
 */
export function onLayerOpenFocus(
  event: Event,
  callerHandler: ((event: Event) => void) | undefined,
): void {
  callerHandler?.(event);
  if (event.defaultPrevented) return;
  const container = event.target;
  if (!(container instanceof HTMLElement)) return;
  // A field the dialog focused itself (`autoFocus`, laptop only) already holds focus.
  if (container.contains(document.activeElement) && document.activeElement !== container) return;
  if (finePointer()) {
    const field = firstField(container);
    if (field) {
      event.preventDefault();
      field.focus();
    }
    return;
  }
  event.preventDefault();
  container.focus({ preventScroll: true });
}

/**
 * Where focus goes when a dialog or sheet closes (v7.5 keyboard audit K1): back to what had it
 * when the layer opened, so Tab carries on from the row or button that opened it. Radix returns
 * focus only to a `*Trigger`; most of MaxOff's layers open from state (a ⋯ menu item, a row's
 * Approve), and focus fell to `<body>`, the top of the page.
 * The opener is read on the render that opens the layer (`opening`, `modal-opening.ts`), before
 * anything is committed: a field with `autoFocus` takes focus during the commit, before Radix's
 * own open-focus event (which then never fires). `restore` runs as the layer closes; the
 * caller's own handler runs first and may take it (`preventDefault`). An opener that left the
 * page meanwhile (the row was decided) leaves Radix's own choice standing.
 */
export function useLayerReturnFocus(opening: number): {
  restore: (event: Event, callerHandler: ((event: Event) => void) | undefined) => void;
} {
  // A layer mounted already open (rendered only while open) reads it on its first render.
  const [origin, setOrigin] = React.useState(() => ({
    opening,
    element: opening > 0 ? currentFocusOrigin() : null,
  }));
  if (origin.opening !== opening) {
    // Derived from the previous render, as `useModalOpening` does: this render opens the layer.
    setOrigin({ opening, element: currentFocusOrigin() });
  }
  const target = origin.element;
  return {
    restore(event, callerHandler) {
      callerHandler?.(event);
      if (event.defaultPrevented || !target?.isConnected) return;
      // On touch a text field is left alone: focusing it would open the on-screen keyboard.
      if (!finePointer() && opensKeyboard(target)) return;
      event.preventDefault();
      target.focus({ preventScroll: true });
    },
  };
}

/** A field that brings up the on-screen keyboard when focused. */
function opensKeyboard(element: HTMLElement): boolean {
  if (element.isContentEditable || element instanceof HTMLTextAreaElement) return true;
  return (
    element instanceof HTMLInputElement &&
    !["button", "checkbox", "radio", "submit", "reset", "file", "range", "color"].includes(
      element.type,
    )
  );
}

/** What has focus now, as `focusOrigin` reads it; nothing on the server. */
function currentFocusOrigin(): HTMLElement | null {
  return typeof document === "undefined" ? null : focusOrigin(document.activeElement);
}

/**
 * The element a layer should hand focus back to. A ⋯ menu's item is gone once its menu closes,
 * so the menu's own trigger stands in (Radix labels the menu with its trigger's id).
 */
export function focusOrigin(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  const menu = active.closest('[role="menu"]');
  if (!menu) return active;
  const triggerId = menu.getAttribute("aria-labelledby");
  const trigger = triggerId ? document.getElementById(triggerId) : null;
  return trigger instanceof HTMLElement ? trigger : null;
}
