"use client";

import { Loader2Icon } from "lucide-react";
import { type ReactNode, useId, useState, useTransition } from "react";

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
  submitLabel = "Submit",
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
  submitLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Resolve `false` to keep the dialog open with the reason (the save failed). */
  onSubmit: (reason: string) => void | boolean | Promise<void | boolean>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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
    startTransition(async () => {
      // `false` means it failed (the caller has said why): keep the dialog and what was typed.
      if ((await onSubmit(reason.trim())) === false) return;
      setReason("");
      onOpenChange(false);
    });
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
              <p id={errorId} role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
              {cancelLabel}
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
