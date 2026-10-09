"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  CustomFieldsForm,
  type CustomFieldValues,
} from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import type { ResultError } from "@/core/errors";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { NAV_FORWARD } from "@/core/ui/motion/nav-types";
import { nameSlide } from "@/core/ui/motion/slide";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { describeError } from "@/core/ui/toast";

import { createClient, createOwnClient } from "../actions/clients";
import { CLIENT_NAME_MAX } from "../domain/limits";

import type { AdminOption } from "./use-client-actions";

const NONE = "__none__";

/**
 * "New client" for the Owner (`clients.manage`, 3.4): the name (the only required detail), an
 * optional Admin, and the company-wide client custom fields (a required one is checked here, the
 * form that saves it, WORKFLOWS §4a). The client starts as a Draft; the rest is filled in on its
 * page with the edit pattern. On success the sheet's entry is backed out and the new client's page
 * is pushed (§14.2 b, e: back returns to the list, never to the form).
 *
 * **An Admin's** (`own`, `clients.create` without `clients.manage`; kickoff 7 amendment B): no
 * Admin picker, the client is theirs and starts Active (`client_create`), so they can onboard it
 * end to end; the Owner is told.
 */
export function NewClientDialog({
  admins,
  definitions,
  own = false,
}: {
  admins: readonly AdminOption[];
  definitions: readonly FieldDefinition[];
  own?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [adminId, setAdminId] = useState("");
  const [customFields, setCustomFields] = useState<CustomFieldValues>({});
  const [error, setError] = useState<ResultError | null>(null);
  const action = useAction(
    async () => {
      const result = own
        ? await createOwnClient({ name, customFields })
        : await createClient({ name, adminId, customFields });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const href = `/clients/${result.data.id}`;
      closeOverlaysThen(() => {
        nameSlide("forward");
        router.push(href, { transitionTypes: [NAV_FORWARD] });
      });
    },
    { resetKey: open, creates: true },
  );
  const { pending } = action;

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setName("");
      setAdminId("");
      setCustomFields({});
      setError(null);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run();
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="strong">
          <PlusIcon aria-hidden />
          New client
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New client</DialogTitle>
            <DialogDescription>
              {own
                ? "It starts Active, and you run it. Add the rest on its page."
                : "It starts as a draft. Add the rest on its page, then activate it once it has an Admin."}
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}
          <FormField label="Client name" error={fieldErrors.name}>
            {(control) => (
              <Input
                {...control}
                name="name"
                value={name}
                maxLength={CLIENT_NAME_MAX}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
              />
            )}
          </FormField>
          {own ? null : (
            <FormField
              label="Admin"
              hint="Optional now; a client is activated once it has one."
              error={fieldErrors.adminId}
            >
              {(control) => (
                <Select
                  value={adminId || NONE}
                  onValueChange={(next) => setAdminId(next === NONE ? "" : next)}
                >
                  <SelectTrigger
                    id={control.id}
                    className="w-full"
                    aria-describedby={control["aria-describedby"]}
                    aria-invalid={control["aria-invalid"]}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No Admin yet</SelectItem>
                    {admins.map((admin) => (
                      <SelectItem key={admin.id} value={admin.id}>
                        {admin.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}
          <CustomFieldsForm
            definitions={definitions}
            values={customFields}
            onChange={setCustomFields}
            errors={fieldErrors}
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
              pendingLabel="Creating client…"
            >
              Create client
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
