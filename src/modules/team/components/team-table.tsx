"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontalIcon, UsersIcon } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { formatIST } from "@/core/time";
import { DataTable, type MobileCard } from "@/core/ui/composites/data-table";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { StatusBadge, StatusDot } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import { toastResult } from "@/core/ui/toast";

import { issueInviteLink, reactivateMember } from "../actions/members";
import { memberActions, ROLE_LABELS, STATUS_LABELS, type TeamMember } from "../domain/members";

import { ChangeEmailDialog } from "./change-email-dialog";
import { DeactivateMemberDialog } from "./deactivate-member-dialog";
import { EditMemberDialog } from "./edit-member-dialog";
import { InviteLinkDialog, type InviteLinkState } from "./invite-link-dialog";
import type { JobTitleOption } from "./job-title-select";

/** Whoever has attendance (2.4): not the Owner, and not someone who never joined. */
function opensHistory(canViewAttendance: boolean, member: TeamMember): boolean {
  return canViewAttendance && member.role !== "owner" && member.joinedAt !== null;
}

type DialogState =
  | { kind: "none" }
  | { kind: "edit"; member: TeamMember }
  | { kind: "email"; member: TeamMember }
  | { kind: "link"; member: TeamMember; state: InviteLinkState }
  | { kind: "deactivate"; member: TeamMember };

/**
 * The team list (PERMISSIONS §2: Admins see no email). Row actions appear only for
 * `team.manage`; the transition functions and RLS decide for real.
 */
export function TeamTable({
  members,
  viewer,
  jobTitles,
}: {
  members: TeamMember[];
  /** `canViewAttendance` (2.4): each person's name leads to their attendance and leave. */
  viewer: { id: string; canManage: boolean; canViewAttendance?: boolean };
  jobTitles: readonly JobTitleOption[];
}) {
  const canViewAttendance = viewer.canViewAttendance === true;
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [, startTransition] = useTransition();

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

  const columns = useMemo<ColumnDef<TeamMember>[]>(() => {
    const base: ColumnDef<TeamMember>[] = [
      {
        accessorKey: "fullName",
        header: "Name",
        cell: ({ row }) => (
          <div className="min-w-0">
            {opensHistory(canViewAttendance, row.original) ? (
              <DrillLink
                href={`/people/${row.original.id}`}
                className="block truncate font-medium underline-offset-4 hover:underline"
              >
                {row.original.fullName}
              </DrillLink>
            ) : (
              <p className="truncate font-medium">{row.original.fullName}</p>
            )}
            <p className="text-muted-foreground truncate text-xs">
              {row.original.jobTitle ?? "No job title"}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => ROLE_LABELS[row.original.role],
        size: 90,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} label={STATUS_LABELS[row.original.status]} />
        ),
        size: 120,
      },
    ];
    if (viewer.canManage) {
      base.push(
        {
          accessorKey: "email",
          header: "Email",
          cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span>,
        },
        {
          id: "since",
          header: "Since",
          accessorFn: (member) => member.joinedAt ?? member.invitedAt ?? member.createdAt,
          cell: ({ row }) => {
            const member = row.original;
            const at = member.joinedAt ?? member.invitedAt ?? member.createdAt;
            return (
              <span className="text-muted-foreground whitespace-nowrap">
                {member.joinedAt ? "Joined" : "Invited"} {formatIST(at, "d MMM yyyy")}
              </span>
            );
          },
          size: 150,
        },
        {
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          enableSorting: false,
          size: 48,
          cell: ({ row }) => {
            const member = row.original;
            const actions = memberActions(viewer, member);
            if (!Object.values(actions).some(Boolean)) return null;
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Actions for ${member.fullName}`}
                  >
                    <MoreHorizontalIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {actions.edit ? (
                    <DropdownMenuItem onSelect={() => setDialog({ kind: "edit", member })}>
                      Edit
                    </DropdownMenuItem>
                  ) : null}
                  {actions.changeEmail ? (
                    <DropdownMenuItem onSelect={() => setDialog({ kind: "email", member })}>
                      Change sign-in email
                    </DropdownMenuItem>
                  ) : null}
                  {actions.copyInviteLink ? (
                    <DropdownMenuItem onSelect={() => issueLink(member)}>
                      Copy invite link
                    </DropdownMenuItem>
                  ) : null}
                  {actions.reactivate ? (
                    <DropdownMenuItem onSelect={() => reactivate(member)}>
                      Reactivate
                    </DropdownMenuItem>
                  ) : null}
                  {actions.revokeInvite || actions.deactivate ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDialog({ kind: "deactivate", member })}
                      >
                        {actions.revokeInvite ? "Revoke invite" : "Deactivate"}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          },
        },
      );
    }
    return base;
    // `issueLink` and `reactivate` only close over stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.id, viewer.canManage, canViewAttendance]);

  const close = () => setDialog({ kind: "none" });

  /**
   * The phone shape (ARCHITECTURE §14.1). A card shows who someone is and where they stand;
   * the email, the date and every action live in the sheet a tap opens. The desktop dropdown
   * is hover-adjacent and 32px wide — neither belongs on a phone.
   */
  const mobile: MobileCard<TeamMember> = {
    title: (member) => member.fullName,
    subtitle: (member) => `${ROLE_LABELS[member.role]} · ${member.jobTitle ?? "No job title"}`,
    trailing: (member) => <StatusDot status={member.status} label={STATUS_LABELS[member.status]} />,
    detail: (member) => {
      const at = member.joinedAt ?? member.invitedAt ?? member.createdAt;
      return (
        <dl className="flex flex-col gap-3">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Role</dt>
            <dd className="text-right font-medium">{ROLE_LABELS[member.role]}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Job title</dt>
            <dd className="text-right">{member.jobTitle ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="text-right">
              <StatusBadge status={member.status} label={STATUS_LABELS[member.status]} />
            </dd>
          </div>
          {member.email ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground shrink-0">Email</dt>
              <dd className="min-w-0 truncate text-right">{member.email}</dd>
            </div>
          ) : null}
          {member.phone ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Phone</dt>
              <dd className="text-right">{member.phone}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{member.joinedAt ? "Joined" : "Invited"}</dt>
            <dd className="text-right">{formatIST(at, "d MMM yyyy")}</dd>
          </div>
          {opensHistory(canViewAttendance, member) ? (
            // In the sheet body, not its actions: those close the sheet by state, and the link
            // backs the sheet's entry out itself before opening the person (§14.2 a, b).
            <div className="pt-1">
              <Button variant="outline" className="w-full" asChild>
                <OverlayLink href={`/people/${member.id}`}>Attendance &amp; leave</OverlayLink>
              </Button>
            </div>
          ) : null}
        </dl>
      );
    },
    actions: (member) => {
      const actions = memberActions(viewer, member);
      if (!Object.values(actions).some(Boolean)) return null;
      return (
        <>
          {actions.edit ? (
            <Button variant="outline" onClick={() => setDialog({ kind: "edit", member })}>
              Edit
            </Button>
          ) : null}
          {actions.changeEmail ? (
            <Button variant="outline" onClick={() => setDialog({ kind: "email", member })}>
              Change sign-in email
            </Button>
          ) : null}
          {actions.copyInviteLink ? (
            <Button variant="outline" onClick={() => issueLink(member)}>
              Copy invite link
            </Button>
          ) : null}
          {actions.reactivate ? (
            <Button variant="outline" onClick={() => reactivate(member)}>
              Reactivate
            </Button>
          ) : null}
          {actions.revokeInvite || actions.deactivate ? (
            // Destructive last, with the others between it and the thumb (§14.1).
            <Button variant="destructive" onClick={() => setDialog({ kind: "deactivate", member })}>
              {actions.revokeInvite ? "Revoke invite" : "Deactivate"}
            </Button>
          ) : null}
        </>
      );
    },
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={members}
        getRowId={(member) => member.id}
        pageSize={0}
        caption="The team"
        mobile={mobile}
        emptyState={
          <EmptyState
            icon={UsersIcon}
            title="Nobody here yet"
            description="Invite the first person and they appear here."
          />
        }
      />
      {dialog.kind === "edit" ? (
        <EditMemberDialog
          member={dialog.member}
          viewerId={viewer.id}
          jobTitles={jobTitles}
          onClose={close}
        />
      ) : null}
      {dialog.kind === "email" ? (
        <ChangeEmailDialog key={dialog.member.id} member={dialog.member} onClose={close} />
      ) : null}
      {dialog.kind === "deactivate" ? (
        <DeactivateMemberDialog member={dialog.member} onClose={close} />
      ) : null}
      {dialog.kind === "link" ? (
        <InviteLinkDialog member={dialog.member} state={dialog.state} onClose={close} />
      ) : null}
    </>
  );
}
