"use client";

import { Loader2Icon, UserPlusIcon } from "lucide-react";
import { useState, useTransition } from "react";

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

import { type InviteOutcome, inviteMember } from "../actions/members";
import { INVITABLE_ROLES, type InvitableRole } from "../domain/schemas";

import { InviteLinkPanel } from "./invite-link-panel";
import { JobTitleSelect, type JobTitleOption } from "./job-title-select";

const ROLE_COPY: Record<InvitableRole, string> = {
  admin: "Admin: runs their clients and the staff work they create or approve",
  staff: "Staff: does the tasks allotted to them",
};

const EMAIL_COPY: Record<InviteOutcome["email"], string> = {
  sent: "An email with this link is on its way.",
  not_configured: "Email is not set up yet, so share this link yourself.",
  failed: "The email could not be sent; share this link yourself.",
};

/**
 * Invite (Owner only, `team.manage`): email, name, role and job title. On success the dialog
 * shows the invite link once, whether or not the email went out (WORKFLOWS §1a).
 */
export function InviteMemberDialog({ jobTitles }: { jobTitles: readonly JobTitleOption[] }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<InvitableRole>("staff");
  const [jobTitleId, setJobTitleId] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setEmail("");
    setFullName("");
    setRole("staff");
    setJobTitleId("");
    setError(null);
    setOutcome(null);
  }

  // Closing is refused only while the invite is being created. Once the link is on screen the
  // transition may still be "pending" (Next refreshes the route after revalidatePath), and
  // Done must work regardless.
  function onOpenChange(next: boolean) {
    if (pending && !outcome) return;
    setOpen(next);
    if (!next) reset();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await inviteMember({ email, fullName, role, jobTitleId });
      if (result.ok) {
        setError(null);
        setOutcome(result.data);
      } else {
        setError(result.error);
      }
    });
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <UserPlusIcon aria-hidden />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        {outcome ? (
          <>
            <DialogHeader>
              <DialogTitle>{fullName} is invited</DialogTitle>
              <DialogDescription>{EMAIL_COPY[outcome.email]}</DialogDescription>
            </DialogHeader>
            <InviteLinkPanel link={outcome.link} />
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Invite someone</DialogTitle>
              <DialogDescription>
                They get a link to choose a password. Role is what they may do; job title is just a
                label.
              </DialogDescription>
            </DialogHeader>
            {summary ? (
              <p role="alert" data-slot="form-alert" className="text-destructive text-sm">
                {summary.description ?? summary.title}
              </p>
            ) : null}
            <FormField label="Email" error={fieldErrors.email}>
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
                />
              )}
            </FormField>
            <FormField label="Full name" error={fieldErrors.fullName}>
              {(control) => (
                <Input
                  {...control}
                  autoComplete="off"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                />
              )}
            </FormField>
            <FormField label="Role" error={fieldErrors.role} hint={ROLE_COPY[role]}>
              {(control) => (
                <Select value={role} onValueChange={(next) => setRole(next as InvitableRole)}>
                  <SelectTrigger
                    id={control.id}
                    className="w-full"
                    aria-describedby={control["aria-describedby"]}
                    aria-invalid={control["aria-invalid"]}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVITABLE_ROLES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === "admin" ? "Admin" : "Staff"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label="Job title" error={fieldErrors.jobTitleId}>
              {(control) => (
                <JobTitleSelect
                  id={control.id}
                  value={jobTitleId}
                  onChange={setJobTitleId}
                  options={jobTitles}
                  describedBy={control["aria-describedby"]}
                  invalid={control["aria-invalid"]}
                />
              )}
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending} aria-busy={pending}>
                {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                Send invite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
