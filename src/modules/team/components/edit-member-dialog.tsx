"use client";

import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import type { ResultError } from "@/core/errors";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ChangeList } from "@/core/ui/composites/editable-record";
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
import { describeError, toastResult } from "@/core/ui/toast";

import { updateMember } from "../actions/members";
import { memberActions, ROLE_LABELS, type TeamMember } from "../domain/members";
import { INVITABLE_ROLES, type InvitableRole } from "../domain/limits";

import { offerableJobTitles } from "../domain/job-titles";
import { JobTitleSelect, type JobTitleOption } from "./job-title-select";
import { memberChangeLines } from "./member-changes";

/**
 * Name, role (Admin ↔ Staff; locked on the Owner row) and job title: plain edits, audited. Save
 * is disabled until something changed and opens a confirmation that names each change ("Ravi's
 * role will change from Staff to Admin", task 2.9): a role change changes what the person may
 * do. The full move onto `EditableRecord` on `/people/[id]` is ROADMAP 3.4.
 */
export function EditMemberDialog({
  member,
  viewerId,
  jobTitles,
  onClose,
}: {
  member: TeamMember;
  viewerId: string;
  jobTitles: readonly JobTitleOption[];
  onClose: () => void;
}) {
  const [fullName, setFullName] = useState(member.fullName);
  const [role, setRole] = useState<InvitableRole>(member.role === "admin" ? "admin" : "staff");
  const [jobTitleId, setJobTitleId] = useState(member.jobTitleId ?? "");
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const { editRole } = memberActions({ id: viewerId, canManage: true }, member);
  const changes = memberChangeLines(
    member,
    { fullName, role: editRole ? role : member.role, jobTitleId },
    jobTitles,
  );

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changes.length > 0) setConfirming(true);
  }

  async function save(): Promise<boolean> {
    const result = await updateMember({
      memberId: member.id,
      fullName,
      ...(editRole ? { role } : {}),
      jobTitleId,
    });
    if (result.ok) {
      toastResult(result, { success: "Saved" });
      onClose();
    } else {
      startTransition(() => setError(result.error));
    }
    return true;
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit {member.fullName}</DialogTitle>
            <DialogDescription>
              {editRole
                ? "Role is what they may do; job title is just a label."
                : `${ROLE_LABELS[member.role]} stays ${ROLE_LABELS[member.role]}; the name and job title can change.`}
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <p role="alert" data-slot="form-alert" className="text-destructive text-sm">
              {summary.description ?? summary.title}
            </p>
          ) : null}
          <FormField label="Full name" error={fieldErrors.fullName}>
            {(control) => (
              <Input
                {...control}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
                autoFocus
              />
            )}
          </FormField>
          {editRole ? (
            <FormField label="Role" error={fieldErrors.role}>
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
                        {ROLE_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          ) : null}
          <FormField label="Job title" error={fieldErrors.jobTitleId}>
            {(control) => (
              <JobTitleSelect
                id={control.id}
                value={jobTitleId}
                onChange={setJobTitleId}
                options={offerableJobTitles(jobTitles, member.jobTitleId)}
                describedBy={control["aria-describedby"]}
                invalid={control["aria-invalid"]}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || changes.length === 0} aria-busy={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Save these changes?"
        confirmLabel="Save"
        cancelLabel="Keep editing"
        onConfirm={save}
      >
        <ChangeList lines={changes} />
      </ConfirmDialog>
    </Dialog>
  );
}
