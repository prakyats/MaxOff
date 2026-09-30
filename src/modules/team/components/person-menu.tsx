"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { requestEdit } from "@/core/ui/edit/edit-requests";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import { memberActions, memberEditKey, type TeamMember } from "../domain/members";

import { useMemberDialogs } from "./use-member-dialogs";

/**
 * The ⋯ menu in a person's page header (3.4, owner decision 2026-09-25): **Edit** and
 * **Deactivate**, and the rest of the Owner's member actions (change the sign-in email, copy an
 * invite link, reactivate, revoke an invite; a freelancer's coordinator and "Invite as employee",
 * 4C). A layer like every menu (§14.2 a). Edit starts the
 * Profile's edit pattern; from the Leave or Attendance tab it switches to Profile first with a
 * replace (the tabs are views of one screen, §14.2 d).
 */
export function PersonMenu({ member, viewerId }: { member: TeamMember; viewerId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    changeEmail,
    changeCoordinator,
    deactivate,
    inviteAsEmployee,
    issueLink,
    reactivate,
    dialogs,
  } = useMemberDialogs();
  const actions = memberActions({ id: viewerId, canManage: true }, member);
  if (!Object.values(actions).some(Boolean)) return null;

  const profile = `/people/${member.id}`;

  function edit() {
    requestEdit(memberEditKey(member.id));
    if (pathname !== profile) {
      closeOverlaysThen(() => router.replace(profile, { scroll: false }));
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${member.fullName}`}
            data-slot="person-menu"
            className="size-11 md:size-8"
          >
            <MoreHorizontalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {actions.edit ? <DropdownMenuItem onSelect={edit}>Edit</DropdownMenuItem> : null}
          {actions.changeEmail ? (
            <DropdownMenuItem onSelect={() => changeEmail(member)}>
              Change sign-in email
            </DropdownMenuItem>
          ) : null}
          {actions.changeCoordinator ? (
            <DropdownMenuItem onSelect={() => changeCoordinator(member)}>
              Change coordinator
            </DropdownMenuItem>
          ) : null}
          {actions.inviteAsEmployee ? (
            <DropdownMenuItem onSelect={() => inviteAsEmployee(member)}>
              Invite as employee
            </DropdownMenuItem>
          ) : null}
          {actions.copyInviteLink ? (
            <DropdownMenuItem onSelect={() => issueLink(member)}>Copy invite link</DropdownMenuItem>
          ) : null}
          {actions.reactivate ? (
            <DropdownMenuItem onSelect={() => reactivate(member)}>Reactivate</DropdownMenuItem>
          ) : null}
          {actions.revokeInvite || actions.deactivate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => deactivate(member)}>
                {actions.revokeInvite ? "Revoke invite" : "Deactivate"}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogs}
    </>
  );
}
