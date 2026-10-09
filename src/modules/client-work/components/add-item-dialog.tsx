"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
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
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError } from "@/core/ui/toast";

import { addItem } from "../actions/items";
import { ITEM_NOTES_MAX, ITEM_TITLE_MAX } from "../domain/schemas";

/**
 * "Add item" (decision 9): a title, an optional planned date and notes, into this cycle. Mounted
 * while open (its code loads on the first tap, ARCHITECTURE §19). A layer (§14.2 a): back closes
 * it, and asks "Discard this item?" first when something was typed (§14.2 f); back on that keeps
 * editing.
 */
export function AddItemDialog({ cycleId, onClose }: { cycleId: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [planned, setPlanned] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"form" | "discard">("form");
  const dirty = title !== "" || planned !== "" || notes !== "";

  function requestClose() {
    if (pending) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const result = await addItem({
      cycleId,
      title,
      ...(planned ? { plannedDate: planned } : {}),
      ...(notes.trim() ? { notes } : {}),
    });
    setPending(false);
    if (!result.ok) {
      const { title: heading, description } = describeError(result.error);
      const field = Object.keys(result.error.fieldErrors ?? {})[0];
      setError({ ...(field ? { field } : {}), message: description ?? heading });
      return;
    }
    toast.success("Item added");
    onClose();
  }

  return (
    <>
      <Dialog
        open={phase === "form"}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent data-slot="add-item-dialog">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Add an item</DialogTitle>
              <DialogDescription>
                It joins this cycle. The item list stays as it is.
              </DialogDescription>
            </DialogHeader>
            {error && !error.field ? (
              <ErrorText slot="form-alert">{error.message}</ErrorText>
            ) : null}
            <FormField label="Title" error={error?.field === "title" ? error.message : undefined}>
              {(control) => (
                <Input
                  {...control}
                  name="title"
                  value={title}
                  maxLength={ITEM_TITLE_MAX}
                  autoComplete="off"
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  autoFocus
                />
              )}
            </FormField>
            <FormField
              label="Planned date"
              hint="Optional. It shows on the calendar and is overdue once passed."
              error={error?.field === "plannedDate" ? error.message : undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  name="plannedDate"
                  type="date"
                  value={planned}
                  onChange={(event) => setPlanned(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Notes">
              {(control) => (
                <Textarea
                  {...control}
                  name="notes"
                  rows={2}
                  maxLength={ITEM_NOTES_MAX}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              )}
            </FormField>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" pending={pending} pendingLabel="Adding…">
                Add item
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={phase === "discard"}
        onOpenChange={(open) => {
          if (!open) setPhase("form");
        }}
        title="Discard this item?"
        description="What you typed has not been saved."
        confirmLabel="Discard item"
        cancelLabel="Keep editing"
        onConfirm={() => {
          onClose();
        }}
      />
    </>
  );
}
