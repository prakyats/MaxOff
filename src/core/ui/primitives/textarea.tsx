"use client";

import * as React from "react";
import { cn } from "cn";

import { defaultSubmitter, submitFromKey, submitLabel } from "@/core/ui/keyboard/dom";
import { keyIntent } from "@/core/ui/keyboard/keys";
import {
  finePointer,
  submitModifierLabel,
  submitShortcut,
  useFinePointer,
} from "@/core/ui/keyboard/pointer";

/**
 * The multi-line field (a description, a note, a reason). Keyboard rules (ARCHITECTURE §14.3):
 *
 * - **Enter makes a new line; Ctrl+Enter (⌘+Enter on a Mac) submits its form** (rule 3), as its
 *   submit button would; a destructive submit (`<Button destructive>`) is focused instead, never
 *   committed from the key (rule 2).
 * - **On a laptop a quiet hint says so** under the field ("Ctrl+Enter to send note"), drawn only
 *   after hydration and never on touch; `keyHint={false}` leaves it to the caller (the composer
 *   says its own).
 * - **`autoFocus` is a laptop's only** (rule 5).
 *
 * A caller's `onKeyDown` runs first; preventing its default keeps these rules out of the way.
 */
function Textarea({
  className,
  autoFocus,
  onKeyDown,
  keyHint = true,
  ref,
  ...props
}: React.ComponentProps<"textarea"> & {
  /** Show the laptop's "Ctrl+Enter to …" hint under the field (default). */
  keyHint?: boolean;
}) {
  const own = React.useRef<HTMLTextAreaElement | null>(null);
  const [form, setForm] = React.useState<HTMLFormElement | null>(null);
  const fine = useFinePointer();
  const setRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      own.current = node;
      setForm(node?.form ?? null);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  React.useLayoutEffect(() => {
    if (autoFocus && finePointer()) own.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autoFocus acts on mount, as in React
  }, []);

  const hint = fine && keyHint ? submitHint(form) : null;

  const field = (
    <textarea
      ref={setRef}
      data-slot="textarea"
      aria-keyshortcuts={hint ? submitShortcut() : undefined}
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 flex field-sizing-content min-h-16 w-full rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm",
        className,
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (keyIntent(event, { field: "multi", finePointer: finePointer() }) !== "submit") return;
        if (!event.currentTarget.form) return;
        event.preventDefault();
        submitFromKey(event.currentTarget.form);
      }}
      {...props}
    />
  );
  if (!hint) return field;
  return (
    <>
      {field}
      <p data-slot="key-hint" className="text-muted-foreground text-xs">
        {hint}
      </p>
    </>
  );
}

/**
 * "Ctrl+Enter to send note": the form's submit button named, its first letter lowered. None
 * without a form or a submit button, or when the submit is destructive (the key only moves to it).
 */
function submitHint(form: HTMLFormElement | null): string | null {
  if (!form) return null;
  const submitter = defaultSubmitter(form);
  if (!submitter || submitter.dataset.destructive !== undefined) return null;
  const label = submitLabel(form);
  const action = label ? label.charAt(0).toLowerCase() + label.slice(1) : "save";
  return `${submitModifierLabel()}+Enter to ${action}`;
}

export { Textarea };
