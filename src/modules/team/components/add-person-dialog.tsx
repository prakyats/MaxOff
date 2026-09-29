"use client";

import { UserPlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { ResultError } from "@/core/errors";
import { cn } from "@/core/lib/utils";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { describeError } from "@/core/ui/toast";

import { addFreelancer, type InviteOutcome, inviteMember } from "../actions/members";
import { offerableJobTitles } from "../domain/job-titles";
import {
  INVITABLE_ROLES,
  type InvitableRole,
  NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
} from "../domain/limits";

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

type Kind = "employee" | "freelancer";

const KINDS: { value: Kind; title: string; line: string }[] = [
  {
    value: "employee",
    title: "Employee",
    line: "Gets an invite link: they sign in, mark attendance and take leave.",
  },
  {
    value: "freelancer",
    title: "Freelancer",
    line: "No login: a coordinator on the team notes, updates and hands in their tasks for them.",
  },
];

/**
 * "Add person" (Owner only, `team.manage`; PRODUCT §4.17, ADR-0013, 4C): an **Employee** is
 * invited by email as before (WORKFLOWS §1a: the link shows once, whether or not the email went
 * out); a **Freelancer** gets a record with no login, a job title, an optional phone and the
 * **coordinator** who acts for them (any active employee, Admin or Staff, never the Owner:
 * Kickoff 4 decision 8). The choice is a control of the form, not a step in the history.
 */
export function AddPersonDialog({
  jobTitles,
  coordinators,
}: {
  jobTitles: readonly JobTitleOption[];
  /** Active permanent Admins and Staff (`coordinatorOptions`). */
  coordinators: readonly { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("employee");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<InvitableRole>("staff");
  const [jobTitleId, setJobTitleId] = useState("");
  const [phone, setPhone] = useState("");
  const [coordinatorId, setCoordinatorId] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);
  const kindName = useId();

  const invite = useAction(
    async () => {
      const result = await inviteMember({ email, fullName, role, jobTitleId });
      if (result.ok) {
        setError(null);
        setOutcome(result.data);
      } else {
        setError(result.error);
      }
    },
    { resetKey: open, creates: true },
  );
  const add = useAction(
    async () => {
      const result = await addFreelancer({ fullName, jobTitleId, phone, coordinatorId });
      if (result.ok) {
        toast.success(`${fullName.trim()} added`);
        onOpenChange(false, true);
      } else {
        setError(result.error);
      }
    },
    { resetKey: open, creates: true },
  );
  const action = kind === "employee" ? invite : add;
  const pending = invite.pending || add.pending;

  function reset() {
    setKind("employee");
    setEmail("");
    setFullName("");
    setRole("staff");
    setJobTitleId("");
    setPhone("");
    setCoordinatorId("");
    setError(null);
    setOutcome(null);
  }

  // Closing is refused only while the person is being added. Once the link is on screen the
  // transition may still be "pending" (Next refreshes the route after revalidatePath), and Done
  // must work regardless.
  function onOpenChange(next: boolean, done = false) {
    if (pending && !outcome && !done) return;
    setOpen(next);
    if (!next) reset();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    action.run();
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  const offered = offerableJobTitles(jobTitles, null);

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogTrigger asChild>
        <Button variant="strong" data-slot="add-person">
          <UserPlusIcon aria-hidden />
          Add person
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
              <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Add someone</DialogTitle>
              <DialogDescription>
                An employee signs in; a freelancer is looked after by a coordinator on the team.
              </DialogDescription>
            </DialogHeader>
            <fieldset className="flex min-w-0 flex-col gap-2" data-slot="add-person-kind">
              <legend className="mb-1.5 text-sm font-medium">Who are you adding?</legend>
              {KINDS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "border-border flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
                    kind === option.value && "border-foreground",
                  )}
                >
                  <input
                    type="radio"
                    name={kindName}
                    value={option.value}
                    checked={kind === option.value}
                    onChange={() => {
                      setKind(option.value);
                      setError(null);
                    }}
                    className="accent-foreground mt-0.5 size-5 shrink-0"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{option.title}</span>
                    <span className="text-muted-foreground">{option.line}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {summary ? (
              <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
            ) : null}
            {kind === "employee" ? (
              <FormField label="Email" error={fieldErrors.email}>
                {(control) => (
                  <Input
                    {...control}
                    type="email"
                    autoComplete="off"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                )}
              </FormField>
            ) : null}
            <FormField label="Full name" error={fieldErrors.fullName}>
              {(control) => (
                <Input
                  {...control}
                  autoComplete="off"
                  value={fullName}
                  maxLength={NAME_MAX_LENGTH}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                />
              )}
            </FormField>
            {kind === "employee" ? (
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
            ) : (
              <FormField
                label="Coordinator"
                error={fieldErrors.coordinatorId}
                hint="Notes, updates and hands in their tasks for them. You can change it later."
              >
                {(control) => (
                  <Select value={coordinatorId} onValueChange={setCoordinatorId}>
                    <SelectTrigger
                      id={control.id}
                      className="w-full"
                      aria-describedby={control["aria-describedby"]}
                      aria-invalid={control["aria-invalid"]}
                    >
                      <SelectValue placeholder="Choose someone on the team" />
                    </SelectTrigger>
                    <SelectContent>
                      {coordinators.map((person) => (
                        <SelectItem key={person.id} value={person.id}>
                          {person.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}
            <FormField label="Job title" error={fieldErrors.jobTitleId}>
              {(control) => (
                <JobTitleSelect
                  id={control.id}
                  value={jobTitleId}
                  onChange={setJobTitleId}
                  options={offered}
                  describedBy={control["aria-describedby"]}
                  invalid={control["aria-invalid"]}
                />
              )}
            </FormField>
            {kind === "freelancer" ? (
              <FormField label="Phone (optional)" error={fieldErrors.phone}>
                {(control) => (
                  <Input
                    {...control}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    value={phone}
                    maxLength={PHONE_MAX_LENGTH}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                )}
              </FormField>
            ) : null}
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
              {kind === "employee" ? (
                <Button
                  variant="primary"
                  type="submit"
                  pending={invite.pending}
                  pendingLabel="Sending invite…"
                >
                  Send invite
                </Button>
              ) : (
                <Button
                  variant="primary"
                  type="submit"
                  pending={add.pending}
                  pendingLabel="Adding…"
                >
                  Add freelancer
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
