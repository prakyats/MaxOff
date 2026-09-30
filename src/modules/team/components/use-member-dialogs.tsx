"use client";

import { useState, useTransition } from "react";

import { toastResult } from "@/core/ui/toast";

import { issueInviteLink, reactivateMember } from "../actions/members";
import type { TeamMember } from "../domain/members";

import { ChangeEmailDialog } from "./change-email-dialog";
import {
  ChangeCoordinatorDialog,
  InviteEmployeeDialog,
  ReactivateFreelancerDialog,
} from "./coordinator-dialogs";
import { DeactivateMemberDialog } from "./deactivate-member-dialog";
import { InviteLinkDialog, type InviteLinkState } from "./invite-link-dialog";

type DialogState =
  | { kind: "none" }
  | { kind: "email"; member: TeamMember }
  | { kind: "link"; member: TeamMember; state: InviteLinkState }
  | { kind: "deactivate"; member: TeamMember }
  | { kind: "coordinator"; member: TeamMember }
  | { kind: "invite-employee"; member: TeamMember }
  | { kind: "reactivate-freelancer"; member: TeamMember };

/**
 * The Owner's member actions that open a dialog or run at once (1.3, 1.4), shared by the People
 * list and a person's ⋯ menu (3.4): change the sign-in email, copy an invite link, reactivate,
 * revoke an invite or deactivate; for a freelancer (ADR-0013, 4C) change the coordinator, invite
 * them as an employee, and reactivate behind a coordinator. Edit is not here: it is the person
 * page's `EditableRecord`.
 */
export function useMemberDialogs() {
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [, startTransition] = useTransition();
  const close = () => setDialog({ kind: "none" });

  // Issued once, on the menu click: a fresh link stops the previous one working.
  function issueLink(member: TeamMember) {
    setDialog({ kind: "link", member, state: null });
    startTransition(async () => {
      const result = await issueInviteLink({ memberId: member.id });
      setDialog((current) =>
        current.kind === "link" && current.member.id === member.id
          ? { ...current, state: result.ok ? { link: result.data.link } : { error: result.error } }
          : current,
      );
    });
  }

  function reactivate(member: TeamMember) {
    // A freelancer comes back only behind a coordinator (4A decision (a)): asked for first.
    if (member.engagement === "freelance") {
      setDialog({ kind: "reactivate-freelancer", member });
      return;
    }
    startTransition(async () => {
      const result = await reactivateMember({ memberId: member.id });
      if (result.ok) {
        toastResult(result, {
          success:
            result.data.status === "active"
              ? `${member.fullName} is active again`
              : `${member.fullName} is invited again: issue a new link`,
        });
      } else {
        toastResult(result);
      }
    });
  }

  const dialogs = (
    <>
      {dialog.kind === "email" ? (
        <ChangeEmailDialog key={dialog.member.id} member={dialog.member} onClose={close} />
      ) : null}
      {dialog.kind === "deactivate" ? (
        <DeactivateMemberDialog member={dialog.member} onClose={close} />
      ) : null}
      {dialog.kind === "link" ? (
        <InviteLinkDialog member={dialog.member} state={dialog.state} onClose={close} />
      ) : null}
      {dialog.kind === "coordinator" ? (
        <ChangeCoordinatorDialog key={dialog.member.id} member={dialog.member} onClose={close} />
      ) : null}
      {dialog.kind === "invite-employee" ? (
        <InviteEmployeeDialog key={dialog.member.id} member={dialog.member} onClose={close} />
      ) : null}
      {dialog.kind === "reactivate-freelancer" ? (
        <ReactivateFreelancerDialog key={dialog.member.id} member={dialog.member} onClose={close} />
      ) : null}
    </>
  );

  return {
    changeEmail: (member: TeamMember) => setDialog({ kind: "email", member }),
    deactivate: (member: TeamMember) => setDialog({ kind: "deactivate", member }),
    changeCoordinator: (member: TeamMember) => setDialog({ kind: "coordinator", member }),
    inviteAsEmployee: (member: TeamMember) => setDialog({ kind: "invite-employee", member }),
    issueLink,
    reactivate,
    dialogs,
  };
}
