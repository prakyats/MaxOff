"use client";

import { type ReactNode, useId, useState } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { workingLabel } from "@/core/ui/action/working-label";

import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Label } from "@/core/ui/primitives/label";
import { Textarea } from "@/core/ui/primitives/textarea";
import { ErrorText } from "@/core/ui/composites/error-text";

export const REASON_MIN_LENGTH = 3;
export const REASON_MAX_LENGTH = 1000;

/** Pure validation so the rule is testable and shared with server-side zod schemas. */
export function validateReason(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "A reason is required.";
  if (trimmed.length < REASON_MIN_LENGTH) return "Please write a few more words.";
  if (trimmed.length > REASON_MAX_LENGTH) return `Keep it under ${REASON_MAX_LENGTH} characters.`;
  return null;
}

/**
 * Collects the reason that WORKFLOWS requires for rejections, corrections, cancellations and
 * late completions. The reason is trimmed and validated before `onSubmit` runs; the
 * transition function validates it again (`REASON_REQUIRED`).
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label = "Reason",
  placeholder = "Explain briefly. This is recorded in the history.",
  submitLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  label?: string;
  placeholder?: string;
  /**
   * The one solid red button, named for what it does ("Reject leave", "Cancel this leave"),
   * never "Submit" or "OK" (ARCHITECTURE §14.1, the action colour rule).
   */
  submitLabel: string;
  /** The button while it runs; defaults to the label's verb in -ing ("Rejecting leave…"). */
  pendingLabel?: string;
  cancelLabel?: string;
  /**
   * The act is destructive (cancel, reject, decline, revoke): Ctrl+Enter in the reason moves to
   * the named button instead of committing (ARCHITECTURE §14.3 rule 2), and no hint offers it.
   */
  destructive?: boolean;
  /** Resolve `false` to keep the dialog open with the reason (the save failed). */
  onSubmit: (reason: string) => void | boolean | Promise<void | boolean>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // One request per tap; a slow or failed one is said under the buttons and what was typed
  // stays (ARCHITECTURE §14.1).
  // The reason is read when it runs, not when it was first tapped: a Retry after the reason was
  // corrected sends the corrected one (v1.0.0 review), checked again the same way.
  const action = useAction(
    async () => {
      const problem = validateReason(reason);
      if (problem) {
        setError(problem);
        return;
      }
      // `false` means it failed (the caller has said why): keep the dialog and what was typed.
      if ((await onSubmit(reason.trim())) === false) return;
      setReason("");
      onOpenChange(false);
    },
    { resetKey: open },
  );
  const { pending } = action;
  const id = useId();
  const errorId = `${id}-error`;

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setReason("");
      setError(null);
    }
    onOpenChange(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateReason(reason);
    setError(problem);
    if (problem) return;
    action.run();
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="contents">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={id}>{label}</Label>
            <Textarea
              id={id}
              name="reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (error) setError(null);
              }}
              placeholder={placeholder}
              rows={4}
              maxLength={REASON_MAX_LENGTH + 50}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              autoFocus
            />
            {error ? (
              <ErrorText slot="field-error" id={errorId}>
                {error}
              </ErrorText>
            ) : null}
          </div>
          <ActionStatus action={action} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => close(false)}
              disabled={pending}
            >
              {cancelLabel}
            </Button>
            <Button
              type="submit"
              variant="primary"
              destructive={destructive}
              pending={pending}
              pendingLabel={pendingLabel ?? workingLabel(submitLabel)}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
