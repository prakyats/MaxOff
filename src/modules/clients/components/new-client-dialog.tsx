"use client";

import { Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  CustomFieldsForm,
  type CustomFieldValues,
} from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import type { ResultError } from "@/core/errors";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { NAV_FORWARD } from "@/core/ui/motion/nav-types";
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

import { createClient } from "../actions/clients";
import { CLIENT_NAME_MAX } from "../domain/limits";

import type { AdminOption } from "./use-client-actions";

const NONE = "__none__";

/**
 * "New client" for the Owner (`clients.manage`, 3.4): the name (the only required detail), an
 * optional Admin, and the company-wide client custom fields (a required one is checked here, the
 * form that saves it, WORKFLOWS §4a). The client starts as a Draft; the rest is filled in on its
 * page with the edit pattern. On success the sheet's entry is backed out and the new client's page
 * is pushed (§14.2 b, e: back returns to the list, never to the form).
 */
export function NewClientDialog({
  admins,
  definitions,
}: {
  admins: readonly AdminOption[];
  definitions: readonly FieldDefinition[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [adminId, setAdminId] = useState("");
  const [customFields, setCustomFields] = useState<CustomFieldValues>({});
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, setPending] = useState(false);

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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await createClient({ name, adminId, customFields });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const href = `/clients/${result.data.id}`;
      closeOverlaysThen(() => router.push(href, { transitionTypes: [NAV_FORWARD] }));
    } finally {
      setPending(false);
    }
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
              It starts as a draft. Add the rest on its page, then activate it once it has an Admin.
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
          <CustomFieldsForm
            definitions={definitions}
            values={customFields}
            onChange={setCustomFields}
            errors={fieldErrors}
            disabled={pending}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Create client
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
