"use client";

import { Loader2Icon } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

import type { ResultError } from "@/core/errors";
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
import { Input } from "@/core/ui/primitives/input";
import { describeError, toastResult } from "@/core/ui/toast";

import { createHoliday } from "../actions/settings";

/**
 * Adding a holiday: a date and a name, in a dialog opened by the panel's neutral "Add holiday"
 * (the action colour rule, owner decision 2026-09-26: the days-off screen's one red button is
 * "Save days off"; the holiday's own commit is the red button in here). Mounted fresh each time
 * it opens, so it always starts empty. Back closes it (a dialog is a layer, §14.2 a).
 */
export function AddHolidayDialog({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createHoliday({ date, name });
      if (result.ok) {
        toastResult(result, { success: "Holiday added" });
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add a holiday</DialogTitle>
            <DialogDescription>
              On that date nobody is marked absent. People may still log in and work.
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}
          <FormField label="Date" error={fieldErrors.date}>
            {(control) => (
              <Input
                {...control}
                name="date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                autoFocus
                required
              />
            )}
          </FormField>
          <FormField label="Name" error={fieldErrors.name}>
            {(control) => (
              <Input
                {...control}
                name="name"
                placeholder="Diwali"
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
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
              Add holiday
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
