"use client";

import { UserPlusIcon } from "lucide-react";
import { useState } from "react";

import {
  CustomFieldsForm,
  type CustomFieldValues,
  type MemberOption,
} from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
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
  DialogTrigger,
} from "@/core/ui/primitives/dialog";
import { Input } from "@/core/ui/primitives/input";
import { describeError, toastResult } from "@/core/ui/toast";

import { createContact } from "../actions/clients";
import { CLIENT_PHONE_MAX, CONTACT_DESIGNATION_MAX, CONTACT_NAME_MAX } from "../domain/limits";

type Draft = { name: string; designation: string; email: string; phone: string };
const EMPTY: Draft = { name: "", designation: "", email: "", phone: "" };

/**
 * "Add contact" on a client's Overview (3.4): name (required), designation, email, phone and the
 * contact custom fields. The first live contact becomes the primary one by trigger (kickoff 3
 * decision 4). A bottom sheet on a phone; its one red button adds the contact, and the sheet
 * closes back to the Overview, which now lists them.
 */
export function AddContactDialog({
  clientId,
  clientName,
  definitions,
  members,
}: {
  clientId: string;
  clientName: string;
  definitions: readonly FieldDefinition[];
  members: readonly MemberOption[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [customFields, setCustomFields] = useState<CustomFieldValues>({});
  const [error, setError] = useState<ResultError | null>(null);
  const action = useAction(
    async () => {
      const result = await createContact({ clientId, ...draft, customFields });
      if (result.ok) {
        toastResult(result, { success: `${result.data.name} added` });
        // Closed directly: `onOpenChange` ignores a close while the action is still pending.
        setOpen(false);
        reset();
      } else {
        setError(result.error);
      }
    },
    { resetKey: open, creates: true },
  );
  const { pending } = action;

  function reset() {
    setDraft(EMPTY);
    setCustomFields({});
    setError(null);
  }

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) reset();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run();
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  const set = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [key]: event.target.value });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" data-slot="add-contact">
          <UserPlusIcon aria-hidden />
          Add contact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add a contact</DialogTitle>
            <DialogDescription>Someone at {clientName} the team talks to.</DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}
          <FormField label="Name" error={fieldErrors.name}>
            {(control) => (
              <Input
                {...control}
                name="name"
                value={draft.name}
                maxLength={CONTACT_NAME_MAX}
                autoComplete="off"
                onChange={set("name")}
                required
                autoFocus
              />
            )}
          </FormField>
          <FormField label="Designation" error={fieldErrors.designation}>
            {(control) => (
              <Input
                {...control}
                name="designation"
                value={draft.designation}
                maxLength={CONTACT_DESIGNATION_MAX}
                autoComplete="off"
                onChange={set("designation")}
              />
            )}
          </FormField>
          <FormField label="Email" error={fieldErrors.email}>
            {(control) => (
              <Input
                {...control}
                name="email"
                type="email"
                inputMode="email"
                value={draft.email}
                autoComplete="off"
                onChange={set("email")}
              />
            )}
          </FormField>
          <FormField label="Phone" error={fieldErrors.phone}>
            {(control) => (
              <Input
                {...control}
                name="phone"
                type="tel"
                inputMode="tel"
                value={draft.phone}
                maxLength={CLIENT_PHONE_MAX}
                autoComplete="off"
                onChange={set("phone")}
              />
            )}
          </FormField>
          <CustomFieldsForm
            definitions={definitions}
            values={customFields}
            onChange={setCustomFields}
            errors={fieldErrors}
            members={members}
            disabled={pending}
          />
          <ActionStatus action={action} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              pending={pending}
              pendingLabel="Adding contact…"
            >
              Add contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
