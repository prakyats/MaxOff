"use client";

import { Loader2Icon } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

import type { ResultError } from "@/core/errors";
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

import { changeMemberEmail } from "../actions/members";
import type { TeamMember } from "../domain/members";
import { ErrorText } from "@/core/ui/composites/error-text";

/**
 * The Owner moves someone's sign-in to another address (WORKFLOWS §1a). Their password and
 * their open sessions are untouched; both addresses are told. Mounted fresh per member
 * (`key`), so the field always starts from the right address.
 */
export function ChangeEmailDialog({
  member,
  onClose,
}: {
  member: TeamMember;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await changeMemberEmail({ memberId: member.id, email });
      if (result.ok) {
        toastResult(result, {
          success:
            result.data.email === "sent"
              ? `${member.fullName} signs in with ${email.trim().toLowerCase()} now; both addresses were told`
              : `${member.fullName} signs in with ${email.trim().toLowerCase()} now`,
        });
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
            <DialogTitle>Change the sign-in for {member.fullName}</DialogTitle>
            <DialogDescription>
              {member.status === "invited"
                ? "Their pending invite link stops working: send a fresh one with Copy invite link afterwards."
                : "Their password and open sessions stay as they are."}{" "}
              Both the old and the new address are told about the change.
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}
          <FormField label="Current address">
            {(control) => <Input {...control} value={member.email ?? ""} readOnly disabled />}
          </FormField>
          <FormField
            label="New address"
            error={error?.fieldErrors?.email}
            hint="They sign in with this from now on, using the same password."
          >
            {(control) => (
              <Input
                {...control}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="off"
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
              Change sign-in
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
