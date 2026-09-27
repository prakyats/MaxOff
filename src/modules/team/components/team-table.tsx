"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontalIcon, PencilIcon, UsersIcon } from "lucide-react";
import { type MouseEvent, useMemo } from "react";

import { formatIST } from "@/core/time";
import { DataTable, type MobileCard } from "@/core/ui/composites/data-table";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { StatusBadge, StatusDot } from "@/core/ui/composites/status-badge";
import { requestEdit } from "@/core/ui/edit/edit-requests";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import {
  memberActions,
  memberEditKey,
  opensPersonPage,
  ROLE_LABELS,
  STATUS_LABELS,
  type TeamMember,
} from "../domain/members";

import { useMemberDialogs } from "./use-member-dialogs";

/** Edit on the person's page, unless the link is opening in another tab (3.4 review). */
function editOnArrival(event: MouseEvent, memberId: string): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  requestEdit(memberEditKey(memberId));
}

/**
 * The team list (PERMISSIONS §2: Admins see no email). Every person opens their page
 * (`/people/[id]`, kickoff 3): the Profile for anyone with `team.view`, and for the Owner their
 * leave and attendance too. The Owner's own row lives on /me, so it opens the sheet instead.
 * Row actions appear only for `team.manage`; the transition functions and RLS decide for real.
 * **Edit** opens the person's page in edit mode (the edit pattern, 3.4), not a dialog.
 */
export function TeamTable({
  members,
  viewer,
}: {
  members: TeamMember[];
  viewer: { id: string; canManage: boolean };
}) {
  const { changeEmail, deactivate, issueLink, reactivate, dialogs } = useMemberDialogs();

  const columns = useMemo<ColumnDef<TeamMember>[]>(() => {
    const base: ColumnDef<TeamMember>[] = [
      {
        accessorKey: "fullName",
        header: "Name",
        cell: ({ row }) => (
          <div className="min-w-0">
            {opensPersonPage(viewer, row.original) ? (
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
                    <DropdownMenuItem asChild>
                      {/* The menu's entry is backed out first, then the page is pushed (§14.2 a). */}
                      <OverlayLink
                        href={`/people/${member.id}`}
                        onClick={(event) => editOnArrival(event, member.id)}
                      >
                        Edit
                      </OverlayLink>
                    </DropdownMenuItem>
                  ) : null}
                  {actions.changeEmail ? (
                    <DropdownMenuItem onSelect={() => changeEmail(member)}>
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
                      <DropdownMenuItem variant="destructive" onSelect={() => deactivate(member)}>
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
    // The handlers only close over stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.id, viewer.canManage]);

  /**
   * The phone shape (ARCHITECTURE §14.1). A card shows who someone is and where they stand, and
   * opens their page (kickoff 3); the email, the date and every action live in the sheet behind
   * ⋯. The Owner's own card has no person page (/me is theirs), so it opens the sheet.
   */
  const mobile: MobileCard<TeamMember> = {
    title: (member) => member.fullName,
    href: (member) => (opensPersonPage(viewer, member) ? `/people/${member.id}` : null),
    moreLabel: (member) => `More for ${member.fullName}`,
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
          {memberActions(viewer, member).edit ? (
            // In the sheet body, not its actions: those close the sheet by state, and the link
            // backs the sheet's entry out itself before opening the person (§14.2 a, b).
            <div className="pt-1">
              <Button variant="secondary" className="w-full" asChild>
                <OverlayLink
                  href={`/people/${member.id}`}
                  onClick={(event) => editOnArrival(event, member.id)}
                >
                  <PencilIcon aria-hidden />
                  Edit
                </OverlayLink>
              </Button>
            </div>
          ) : null}
        </dl>
      );
    },
    actions: (member) => {
      const actions = memberActions(viewer, member);
      const any =
        actions.changeEmail ||
        actions.copyInviteLink ||
        actions.reactivate ||
        actions.revokeInvite ||
        actions.deactivate;
      if (!any) return null;
      return (
        <>
          {actions.changeEmail ? (
            <Button variant="secondary" onClick={() => changeEmail(member)}>
              Change sign-in email
            </Button>
          ) : null}
          {actions.copyInviteLink ? (
            <Button variant="secondary" onClick={() => issueLink(member)}>
              Copy invite link
            </Button>
          ) : null}
          {actions.reactivate ? (
            <Button variant="secondary" onClick={() => reactivate(member)}>
              Reactivate
            </Button>
          ) : null}
          {actions.revokeInvite || actions.deactivate ? (
            // Destructive last, with the others between it and the thumb (§14.1).
            <Button variant="destructive" onClick={() => deactivate(member)}>
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
      {dialogs}
    </>
  );
}
