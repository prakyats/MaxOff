"use client";

import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import type { ResultError } from "@/core/errors";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError } from "@/core/ui/toast";

import { createRequest } from "../actions/requests";
import { REQUEST_DETAILS_MAX, TITLE_MAX } from "../domain/limits";

const NO_CLIENT = "__none__";

/**
 * The "Suggest a task" form (4.6), a layer (§14.2 a): back closes it, and asks "Discard?" first
 * when something was typed (§14.2 f). The draft lives here, outside the `Dialog`, so "Keep
 * editing" brings it back. A create: a lost reply offers no Retry (it could suggest it twice).
 */
export function SuggestTaskDialog({
  clients,
  onClose,
}: {
  clients: readonly { id: string; name: string }[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [clientId, setClientId] = useState(NO_CLIENT);
  const [phase, setPhase] = useState<"form" | "discard">("form");
  const [error, setError] = useState<ResultError | null>(null);
  const action = useAction(
    async () => {
      const result = await createRequest({
        title,
        details,
        clientId: clientId === NO_CLIENT ? null : clientId,
      });
      if (result.ok) {
        toast.success("Suggestion sent");
        onClose();
      } else {
        setError(result.error);
      }
    },
    { creates: true },
  );
  const { pending } = action;
  const dirty = title.trim() !== "" || details.trim() !== "" || clientId !== NO_CLIENT;
  const summary = error && !error.fieldErrors ? describeError(error) : null;

  function requestClose() {
    if (pending) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    action.run();
  }

  return (
    <>
      <Dialog
        open={phase === "form"}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent>
          <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Suggest a task</DialogTitle>
              <DialogDescription>
                The Owner or an Admin makes it a task, or says why not.
              </DialogDescription>
            </DialogHeader>
            {summary ? (
              <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
            ) : null}
            <FormField label="What needs doing" error={error?.fieldErrors?.title}>
              {(control) => (
                <Input
                  {...control}
                  value={title}
                  maxLength={TITLE_MAX}
                  autoComplete="off"
                  onChange={(event) => setTitle(event.target.value)}
                  required
                />
              )}
            </FormField>
            <FormField
              label="Details (optional)"
              hint="Why it matters, a link to a brief."
              error={error?.fieldErrors?.details}
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={REQUEST_DETAILS_MAX}
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                />
              )}
            </FormField>
            {clients.length > 0 ? (
              <FormField label="Client (optional)" error={error?.fieldErrors?.clientId}>
                {(control) => (
                  <Select value={clientId} onValueChange={setClientId}>
                    <SelectTrigger
                      id={control.id}
                      className="w-full"
                      aria-describedby={control["aria-describedby"]}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CLIENT}>No client</SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            ) : null}
            <ActionStatus action={action} />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" pending={pending} pendingLabel="Sending…">
                Send suggestion
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
        title="Discard this suggestion?"
        description="What you typed has not been sent."
        confirmLabel="Discard suggestion"
        cancelLabel="Keep editing"
        onConfirm={() => {
          onClose();
        }}
      />
    </>
  );
}
