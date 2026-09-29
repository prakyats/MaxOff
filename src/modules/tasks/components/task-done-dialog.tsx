"use client";

import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import type { ResultError } from "@/core/errors/result";
import { systemClock } from "@/core/time";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import { submitDone } from "../actions/tasks";
import { NOTE_MAX, REASON_MAX } from "../domain/limits";

/**
 * Done (WORKFLOWS §3.1, §3.3): an optional note whose http/https links the reviewer taps (the
 * hand-in until phase 8, kickoff 4 decision 10) and, past the deadline, the reason it is late
 * (required). A layer: back closes it.
 */
export function DoneDialog({
  open,
  onOpenChange,
  taskId,
  dueAt,
  onBehalfOf,
  forName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  dueAt: string;
  onBehalfOf: string | null;
  forName: string | null;
}) {
  const [note, setNote] = useState("");
  const [lateReason, setLateReason] = useState("");
  const [errors, setErrors] = useState<{
    note?: string | undefined;
    lateReason?: string | undefined;
  }>({});
  const [formError, setFormError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();
  // Read when the dialog renders: the deadline may pass while it is open, and the function
  // decides at the moment it runs (REASON_REQUIRED then shows under the field).
  const late = systemClock().getTime() > Date.parse(dueAt) || errors.lateReason !== undefined;

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setErrors({});
      setFormError(null);
    }
    onOpenChange(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = lateReason.trim();
    if (late && reason.length < 3) {
      setErrors({ lateReason: "Say why it's late: a few words are enough." });
      return;
    }
    startTransition(async () => {
      const result = await submitDone({
        taskId,
        note: note.trim() || null,
        lateReason: late ? reason : null,
        onBehalfOf,
      });
      if (!result.ok) {
        if (result.error.code === "REASON_REQUIRED") {
          setErrors({ lateReason: result.error.message || "Say why it's late." });
        } else if (result.error.fieldErrors?.note?.[0]) {
          setErrors({ note: result.error.fieldErrors.note[0] });
        } else {
          setFormError(result.error);
        }
        return;
      }
      toastResult(result, { success: forName ? `Marked done for ${forName}` : "Marked done" });
      setNote("");
      setLateReason("");
      onOpenChange(false);
    });
  }

  const summary = formError ? describeError(formError) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-slot="task-done-dialog">
        <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{forName ? `Mark done for ${forName}` : "Mark done"}</DialogTitle>
            <DialogDescription>
              It goes for review. The task is locked until then; comments stay open.
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}
          <FormField
            label="Note (optional)"
            hint="Paste a link to the work, such as a Drive folder: the reviewer can open it."
            error={errors.note}
          >
            {(control) => (
              <Textarea
                {...control}
                name="note"
                rows={3}
                maxLength={NOTE_MAX}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setErrors((current) => ({ ...current, note: undefined }));
                }}
              />
            )}
          </FormField>
          {late ? (
            <FormField label="Why is it late?" error={errors.lateReason}>
              {(control) => (
                <Textarea
                  {...control}
                  name="lateReason"
                  rows={2}
                  maxLength={REASON_MAX}
                  value={lateReason}
                  onChange={(event) => {
                    setLateReason(event.target.value);
                    setErrors((current) => ({ ...current, lateReason: undefined }));
                  }}
                  required
                />
              )}
            </FormField>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => close(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {forName ? `Mark done for ${forName}` : "Mark done"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
