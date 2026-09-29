"use client";

import { Loader2Icon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

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
import { Label } from "@/core/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import {
  changeCoordinator,
  type CoordinatorChoices,
  type FreelancerHandoverData,
  getCoordinatorChoices,
  getFreelancerHandover,
  getOpenTaskCount,
  type InviteOutcome,
  inviteAsEmployee,
  reactivateMember,
} from "../actions/members";
import { DEACTIVATE_REASON_MAX_LENGTH } from "../domain/limits";
import type { TeamMember } from "../domain/members";

import { InviteLinkPanel } from "./invite-link-panel";

/** Who may coordinate, read when the dialog opens (`getCoordinatorChoices`). */
function useCoordinatorChoices(memberId: string) {
  const [choices, setChoices] = useState<CoordinatorChoices | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void getCoordinatorChoices({ memberId }).then((result) => {
      if (!live) return;
      if (result.ok) setChoices(result.data);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [memberId]);
  return { choices, failed };
}

function CoordinatorSelect({
  id,
  value,
  onChange,
  options,
  describedBy,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { id: string; name: string }[];
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        className="w-full"
        aria-describedby={describedBy}
        aria-invalid={invalid}
      >
        <SelectValue placeholder="Choose someone on the team" />
      </SelectTrigger>
      <SelectContent>
        {options.map((person) => (
          <SelectItem key={person.id} value={person.id}>
            {person.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Loading({ what }: { what: string }) {
  return (
    <p className="text-muted-foreground flex min-h-11 items-center gap-2 text-sm">
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
      {what}
    </p>
  );
}

/**
 * "Change coordinator" (ADR-0013, WORKFLOWS §1b; `team.manage`): any other active employee, Admin
 * or Staff, never the Owner (Kickoff 4 decision 8); an optional reason that only the Owner and
 * Admins read (decision 20). The history keeps the previous coordinator and when.
 */
export function ChangeCoordinatorDialog({
  member,
  onClose,
}: {
  member: TeamMember;
  onClose: () => void;
}) {
  const { choices, failed } = useCoordinatorChoices(member.id);
  const [coordinatorId, setCoordinatorId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const reasonId = useId();
  const chosen = choices?.options.find((option) => option.id === coordinatorId) ?? null;
  const action = useAction(async () => {
    const result = await changeCoordinator({ memberId: member.id, coordinatorId, reason });
    if (result.ok) {
      toastResult(result, {
        success: `${chosen?.name ?? "The new coordinator"} looks after ${member.fullName} now`,
      });
      onClose();
    } else setError(result.error);
  });
  const { pending } = action;
  const tooLong = reason.trim().length > DEACTIVATE_REASON_MAX_LENGTH;
  const summary = error ? describeError(error) : null;

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change {member.fullName}&apos;s coordinator</DialogTitle>
          <DialogDescription>
            {choices?.current
              ? `${choices.current.name} looks after them now. The new coordinator notes, updates and hands in their tasks from now on.`
              : "The coordinator notes, updates and hands in their tasks for them."}
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <ErrorText>Couldn&apos;t load the team. Close and try again.</ErrorText>
        ) : !choices ? (
          <Loading what="Loading the team…" />
        ) : (
          <>
            {summary ? (
              <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
            ) : null}
            <FormField label="New coordinator" error={error?.fieldErrors?.coordinatorId}>
              {(control) => (
                <CoordinatorSelect
                  id={control.id}
                  value={coordinatorId}
                  onChange={setCoordinatorId}
                  options={choices.options}
                  describedBy={control["aria-describedby"]}
                  invalid={control["aria-invalid"]}
                />
              )}
            </FormField>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={reasonId}>Reason (optional)</Label>
              <Textarea
                id={reasonId}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Kept in the history, for the Owner and Admins."
                rows={3}
                aria-invalid={tooLong ? true : undefined}
              />
              {tooLong ? (
                <ErrorText>
                  Keep the reason under {DEACTIVATE_REASON_MAX_LENGTH} characters.
                </ErrorText>
              ) : null}
            </div>
          </>
        )}
        <ActionStatus action={action} />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => action.run()}
            disabled={!chosen || tooLong}
            pending={pending}
            pendingLabel="Saving…"
          >
            {chosen ? `Make ${chosen.name} the coordinator` : "Choose a coordinator"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Reactivating a freelancer (4A decision (a)): they come back with a coordinator, set first, since
 * `member_reactivate()` refuses a freelancer with none.
 */
export function ReactivateFreelancerDialog({
  member,
  onClose,
}: {
  member: TeamMember;
  onClose: () => void;
}) {
  const { choices, failed } = useCoordinatorChoices(member.id);
  const [coordinatorId, setCoordinatorId] = useState("");
  const options = useMemo(
    () => [...(choices?.current ? [choices.current] : []), ...(choices?.options ?? [])],
    [choices],
  );
  const action = useAction(async () => {
    const result = await reactivateMember({
      memberId: member.id,
      ...(coordinatorId && coordinatorId !== choices?.current?.id ? { coordinatorId } : {}),
    });
    if (toastResult(result, { success: `${member.fullName} is active again` })) onClose();
  });
  const { pending } = action;
  const picked = coordinatorId || choices?.current?.id || "";

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reactivate {member.fullName}?</DialogTitle>
          <DialogDescription>
            A freelancer comes back with a coordinator, who notes, updates and hands in their tasks.
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <ErrorText>Couldn&apos;t load the team. Close and try again.</ErrorText>
        ) : !choices ? (
          <Loading what="Loading the team…" />
        ) : (
          <FormField label="Coordinator">
            {(control) => (
              <CoordinatorSelect
                id={control.id}
                value={picked}
                onChange={setCoordinatorId}
                options={options}
                describedBy={control["aria-describedby"]}
              />
            )}
          </FormField>
        )}
        <ActionStatus action={action} />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => action.run()}
            disabled={!picked}
            pending={pending}
            pendingLabel="Reactivating…"
          >
            Reactivate {member.fullName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EMAIL_COPY: Record<InviteOutcome["email"], string> = {
  sent: "An email with this link is on its way.",
  not_configured: "Email is not set up yet, so share this link yourself.",
  failed: "The email could not be sent; share this link yourself.",
};

/**
 * "Invite as employee" (Kickoff 4 decision 7, WORKFLOWS §1b): the freelancer's own record gets a
 * login, so their task history stays theirs; they become an invited employee and their
 * coordinator stops acting for them at once. Until they accept, nobody can note, tick or hand in
 * their open tasks and they cannot be added to new ones (4A later item L5), which the dialog says
 * before anything is sent.
 */
export function InviteEmployeeDialog({
  member,
  onClose,
}: {
  member: TeamMember;
  onClose: () => void;
}) {
  const [openTasks, setOpenTasks] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void getOpenTaskCount({ memberId: member.id }).then((result) => {
      if (live && result.ok) setOpenTasks(result.data.openTasks);
    });
    return () => {
      live = false;
    };
  }, [member.id]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);
  const action = useAction(
    async () => {
      const result = await inviteAsEmployee({ memberId: member.id, email });
      if (result.ok) {
        setError(null);
        setOutcome(result.data);
      } else setError(result.error);
    },
    { creates: true },
  );
  const { pending } = action;
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  const tasks =
    openTasks === null
      ? "their open tasks"
      : openTasks === 1
        ? "their open task"
        : `their ${openTasks} open tasks`;

  return (
    <Dialog open onOpenChange={(open) => (open || (pending && !outcome) ? undefined : onClose())}>
      <DialogContent>
        {outcome ? (
          <>
            <DialogHeader>
              <DialogTitle>{member.fullName} is invited</DialogTitle>
              <DialogDescription>{EMAIL_COPY[outcome.email]}</DialogDescription>
            </DialogHeader>
            <InviteLinkPanel link={outcome.link} />
            <DialogFooter>
              <Button variant="secondary" type="button" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            noValidate
            className="flex min-w-0 flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              action.run();
            }}
          >
            <DialogHeader>
              <DialogTitle>Invite {member.fullName} as an employee?</DialogTitle>
              <DialogDescription>
                They get a login on the same record, so their task history stays theirs. They become
                Staff with attendance and leave from the day after they join.
              </DialogDescription>
            </DialogHeader>
            <p
              className="bg-attention-soft rounded-lg px-3 py-2 text-sm"
              data-slot="invite-employee-warning"
            >
              {openTasks === 0
                ? "Their coordinator stops acting for them now. They have no open tasks, and until they accept the invite they can't be added to new ones."
                : `Their coordinator stops acting for them now. Until they accept the invite, nobody can note, update or hand in ${tasks}, and they can't be added to new tasks. Reassign any that can't wait first.`}
            </p>
            {summary ? (
              <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
            ) : null}
            <FormField label="Email" error={error?.fieldErrors?.email}>
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
            <ActionStatus action={action} />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                pending={pending}
                pendingLabel="Sending invite…"
              >
                Invite {member.fullName}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export type FreelancerMove = { memberId: string; coordinatorId: string };

/**
 * "Move Ravi's 2 freelancers to: [person ▾]" inside the Owner's deactivation (ADR-0013 §2:
 * deactivating a coordinator first asks where their freelancers go). One pick for all, or one per
 * freelancer. Reports the moves through `onChange`: `[]` when the person coordinates nobody,
 * `null` while the list loads or any freelancer has no new coordinator yet, so the commit waits.
 */
export function FreelancerHandover({
  member,
  onChange,
}: {
  member: { id: string; fullName: string };
  onChange: (moves: FreelancerMove[] | null) => void;
}) {
  const [data, setData] = useState<FreelancerHandoverData | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState("");
  const [each, setEach] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const allId = useId();

  useEffect(() => {
    let live = true;
    void getFreelancerHandover({ memberId: member.id }).then((result) => {
      if (!live) return;
      if (result.ok) setData(result.data);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [member.id]);

  const moves = useMemo<FreelancerMove[] | null>(() => {
    if (!data) return null;
    const chosen = data.freelancers.map((freelancer) => ({
      memberId: freelancer.id,
      coordinatorId: (each ? picks[freelancer.id] : undefined) || all,
    }));
    return chosen.every((move) => move.coordinatorId !== "") ? chosen : null;
  }, [data, each, picks, all]);

  useEffect(() => {
    onChange(moves);
  }, [moves, onChange]);

  if (failed) {
    return (
      <ErrorText>
        Couldn&apos;t load {member.fullName}&apos;s freelancers. Close and try again.
      </ErrorText>
    );
  }
  if (!data) return <Loading what={`Checking who ${member.fullName} looks after…`} />;
  if (data.freelancers.length === 0) return null;

  const count =
    data.freelancers.length === 1 ? "1 freelancer" : `${data.freelancers.length} freelancers`;
  if (data.coordinators.length === 0) {
    return (
      <ErrorText>
        {member.fullName} looks after {count} and nobody else on the team can take them. Invite
        someone first.
      </ErrorText>
    );
  }
  const items = data.coordinators.map((person) => (
    <SelectItem key={person.id} value={person.id}>
      {person.name}
    </SelectItem>
  ));

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" data-slot="freelancer-handover">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={allId}>
          Move {member.fullName}&apos;s {count} to
        </Label>
        <Select value={all} onValueChange={setAll}>
          <SelectTrigger id={allId} className="w-full">
            <SelectValue placeholder="Choose a coordinator" />
          </SelectTrigger>
          <SelectContent>{items}</SelectContent>
        </Select>
      </div>
      {data.freelancers.length > 1 ? (
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => setEach((open) => !open)}
          aria-expanded={each}
        >
          {each ? "One coordinator for all" : "Choose per freelancer"}
        </Button>
      ) : null}
      {each ? (
        <ul className="flex flex-col gap-2">
          {data.freelancers.map((freelancer) => (
            <li key={freelancer.id} className="flex flex-col gap-1.5">
              <Label htmlFor={`${allId}-${freelancer.id}`}>{freelancer.name}</Label>
              <Select
                value={picks[freelancer.id] || all}
                onValueChange={(next) =>
                  setPicks((current) => ({ ...current, [freelancer.id]: next }))
                }
              >
                <SelectTrigger id={`${allId}-${freelancer.id}`} className="w-full">
                  <SelectValue placeholder="Choose a coordinator" />
                </SelectTrigger>
                <SelectContent>{items}</SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * "Change coordinator" on a freelancer's page (4C): the same dialog as the ⋯ menu's, from the
 * Coordinator card where the history is read.
 */
export function ChangeCoordinatorButton({ member }: { member: TeamMember }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        data-slot="change-coordinator"
      >
        Change coordinator
      </Button>
      {open ? <ChangeCoordinatorDialog member={member} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
