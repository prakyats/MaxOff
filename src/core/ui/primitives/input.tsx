"use client";

import * as React from "react";
import { cn } from "cn";

import { defaultSubmitter } from "@/core/ui/keyboard/dom";
import { keyIntent, submitTarget } from "@/core/ui/keyboard/keys";
import { finePointer } from "@/core/ui/keyboard/pointer";

/**
 * The one-line input. On top of the look it carries two keyboard rules (ARCHITECTURE §14.3):
 *
 * - **Enter submits its form** the browser's own way (implicit submission through the form's
 *   submit button), except where that submit is destructive (`<Button destructive>`): then Enter
 *   moves to the named button instead of committing (rule 2).
 * - **`autoFocus` is a laptop's only** (rule 5): on touch nothing is focused by itself, so the
 *   phone's keyboard never opens uninvited.
 */
function Input({
  className,
  type,
  autoFocus,
  onKeyDown,
  ref,
  ...props
}: React.ComponentProps<"input">) {
  const own = React.useRef<HTMLInputElement | null>(null);
  const setRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      own.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // Mount only, before a dialog's own focus runs, as React's `autoFocus` would.
  React.useLayoutEffect(() => {
    if (autoFocus && finePointer()) own.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autoFocus acts on mount, as in React
  }, []);

  return (
    <input
      ref={setRef}
      type={type}
      data-slot="input"
      className={cn(
        "border-input file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm",
        className,
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (keyIntent(event, { field: "single", finePointer: finePointer() }) !== "submit") return;
        const form = event.currentTarget.form;
        if (!form) return;
        const submitter = defaultSubmitter(form);
        if (submitTarget(submitter) !== "focus") return;
        event.preventDefault();
        submitter?.focus();
      }}
      {...props}
    />
  );
}

export { Input };
