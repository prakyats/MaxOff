"use client";

import { Loader2Icon } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

import type { Result, ResultError } from "@/core/errors";
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
import { Input } from "@/core/ui/primitives/input";
import { describeError, toastResult } from "@/core/ui/toast";
import { ErrorText } from "@/core/ui/composites/error-text";

/**
 * Renaming one list entry. Mounted fresh per entry (`key={item.id}` at the call site) so the
 * field starts from the right name without resetting state in an effect.
 */
export function RenameListItemDialog({
  label,
  name: initialName,
  onSubmit,
  onClose,
}: {
  label: string;
  name: string;
  onSubmit: (name: string) => Promise<Result<null>>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await onSubmit(name);
      if (result.ok) {
        toastResult(result, { success: `${label} renamed` });
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  const summary = error && !error.fieldErrors ? describeError(error) : null;

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename {initialName}</DialogTitle>
            <DialogDescription>
              Everyone who has this {label.toLowerCase()} sees the new name.
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}
          <FormField label="Name" error={error?.fieldErrors?.["item.name"]}>
            {(control) => (
              <Input
                {...control}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                autoFocus
                required
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
