"use client";

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
