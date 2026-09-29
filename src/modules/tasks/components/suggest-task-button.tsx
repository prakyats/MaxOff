"use client";

import { LightbulbIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import type { ResultError } from "@/core/errors";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
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
 * "Suggest a task" (4.6; PRODUCT §4.6, WORKFLOWS §3.4; `task_requests.create`: Staff and
 * Admins): a title, optional details and an optional client label (one the suggester can see,
 * Active or Paused, decision 22). The Owner or an Admin makes it a task or declines it with a
 * reason; it waits in Suggested tasks until then. A trigger that opens a form, so neutral solid
 * (a FAB on a phone through `PageHeader`); the commit is inside.
 */
export function SuggestTaskButton({
  clients,
}: {
  /** The client labels the suggester may name. */
  clients: readonly { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="strong" onClick={() => setOpen(true)} data-slot="suggest-task">
        <LightbulbIcon aria-hidden />
        Suggest a task
      </Button>
      {open ? <SuggestTaskDialog clients={clients} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SuggestTaskDialog({
  clients,
  onClose,
}: {
  clients: readonly { id: string; name: string }[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [clientId, setClientId] = useState(NO_CLIENT);
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
  const summary = error && !error.fieldErrors ? describeError(error) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    action.run();
  }

  return (
    <Dialog open onOpenChange={(next) => (next || pending ? undefined : onClose())}>
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
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" pending={pending} pendingLabel="Sending…">
              Send suggestion
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
