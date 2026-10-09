/**
 * Keyboard convenience on a laptop (owner's note 2026-10-08, ARCHITECTURE §14.3). The rules live
 * here as one pure function, so every shared control (the comment composer, `Input`, `Textarea`,
 * the table's search box) decides a key the same way and the rules are unit-tested on their own:
 *
 * - **composer** (task chat): on a laptop (a fine pointer, no touch) Enter sends and Shift+Enter
 *   makes a new line; on a phone Enter makes a new line and the Send button sends. Ctrl/⌘+Enter
 *   sends on either. Never while an IME composition is active, never an empty or whitespace-only
 *   message, never while a send is pending.
 * - **single** (a one-line input in a form): Enter submits the form (the browser's own implicit
 *   submission; `submitTarget` says when it must not).
 * - **multi** (a description, a note, a reason): Enter makes a new line; Ctrl+Enter (⌘+Enter on a
 *   Mac) submits the form.
 * - **search** (a search or filter box): Enter applies, Escape clears.
 */

/** The parts of a `KeyboardEvent` (React's or the DOM's) the rules read. */
export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** The DOM event's own flag; React's synthetic event carries it on `nativeEvent`. */
  isComposing?: boolean;
  /** 229 is the key an IME is still holding (Safari ends a composition with it). */
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}

export type KeyField = "composer" | "single" | "multi" | "search";

export interface KeyContext {
  field: KeyField;
  /** A laptop: a fine pointer that hovers, and no touch (`finePointer()`, read at the key). */
  finePointer: boolean;
  /** The field's text now (the composer: nothing to send when it is blank; search: to clear). */
  value?: string;
  /** A send or a save is on its way: a second one never starts from a key. */
  pending?: boolean;
}

/**
 * What a key means here:
 * - `send` / `submit`: take the key (no new line) and send the message / submit the form;
 * - `apply`: take the key; the search is applied (it already filters as you type);
 * - `clear`: take the key and empty the search box;
 * - `ignore`: take the key and do nothing (Enter on a laptop composer with nothing to send, or
 *   while a send is pending: no new line, no send);
 * - `newline`: leave it to the browser, which makes a new line;
 * - `none`: not ours, leave it alone.
 */
export type KeyIntent = "send" | "submit" | "newline" | "apply" | "clear" | "ignore" | "none";

/** An IME (Japanese, Chinese, Korean, some Indic keyboards) is still composing. */
export function isComposing(event: KeyLike): boolean {
  return (
    event.isComposing === true || event.nativeEvent?.isComposing === true || event.keyCode === 229
  );
}

/** Ctrl+Enter, or ⌘+Enter on a Mac (either is accepted on any platform). */
function withSubmitModifier(event: KeyLike): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
}

export function keyIntent(event: KeyLike, context: KeyContext): KeyIntent {
  if (isComposing(event)) return "none";

  if (event.key === "Escape") {
    if (context.field !== "search") return "none";
    // An empty box lets Escape through to whatever is around it (a sheet closes).
    return (context.value ?? "") !== "" ? "clear" : "none";
  }
  if (event.key !== "Enter") return "none";

  switch (context.field) {
    case "composer": {
      const sends = withSubmitModifier(event)
        ? true
        : context.finePointer &&
          !event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey;
      if (!sends) return "newline";
      if (context.pending || (context.value ?? "").trim() === "") return "ignore";
      return "send";
    }
    case "multi":
      if (!withSubmitModifier(event)) return "newline";
      return context.pending ? "ignore" : "submit";
    case "single":
      if (event.altKey || event.ctrlKey || event.metaKey) return "none";
      return context.pending ? "ignore" : "submit";
    case "search":
      return "apply";
  }
}

/** The parts of a submit button `submitTarget` reads. */
export interface SubmitterLike {
  disabled: boolean;
  /** `data-destructive` on the button: its submit commits a destructive change. */
  dataset: { destructive?: string };
}

/**
 * Where a submit from the keyboard goes (rule 2): `submit` the form as the browser would, or
 * `focus` the named button instead when the form's default submit is marked destructive
 * (`<Button destructive>`: the reason dialog's "Cancel task", "Reject claim"…), so a key never
 * commits a destructive change by itself: the person reads the named button and presses it.
 * `none`: there is no enabled submit button, so nothing happens (as in the browser).
 */
export function submitTarget(submitter: SubmitterLike | null): "submit" | "focus" | "none" {
  if (!submitter || submitter.disabled) return "none";
  return submitter.dataset.destructive !== undefined ? "focus" : "submit";
}
