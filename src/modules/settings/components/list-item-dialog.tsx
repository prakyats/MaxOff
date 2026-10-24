"use client";

import { type FormEvent, useState } from "react";

import type { Result, ResultError } from "@/core/errors";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
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
 * Adding or renaming one list entry: one name field. Add is the list's Add pattern (C4: the
 * heading's "Add job title" opens this, its commit "Add job title"); rename passes the entry's
 * current `name`. Mounted fresh per opening (`key=` at the call site) so the field starts from the
 * right name without resetting state in an effect.
 */
export function ListItemDialog({
  label,
  name: initialName,
  onSubmit,
  onClose,
}: {
  label: string;
  /** The entry's current name when renaming; absent when adding. */
  name?: string;
  onSubmit: (name: string) => Promise<Result<unknown>>;
  onClose: () => void;
}) {
  const adding = initialName === undefined;
  const thing = label.toLowerCase();
  const [name, setName] = useState(initialName ?? "");
  const [error, setError] = useState<ResultError | null>(null);
  const action = useAction(
    async () => {
      const result = await onSubmit(name);
      if (result.ok) {
        toastResult(result, { success: adding ? `${label} added` : `${label} renamed` });
        onClose();
      } else {
        setError(result.error);
      }
    },
    { creates: adding },
  );
  const { pending } = action;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run();
  }

  const summary = error && !error.fieldErrors ? describeError(error) : null;

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{adding ? `Add a ${thing}` : `Rename ${initialName}`}</DialogTitle>
            <DialogDescription>
              {adding
                ? `It is offered wherever people pick a ${thing}.`
                : `Everyone who has this ${thing} sees the new name.`}
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
                // The component serves every list, so the hint comes from the list, not from
                // one example of a job title (ADR-0002: code knows keys, never entries).
                placeholder={adding ? `New ${thing}` : undefined}
                maxLength={80}
                autoFocus
                required
              />
            )}
          </FormField>
          <ActionStatus action={action} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
              data-dismiss=""
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              pending={pending}
              pendingLabel={adding ? "Adding…" : "Saving…"}
            >
              {adding ? `Add ${thing}` : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
