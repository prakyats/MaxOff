import type { Metadata } from "next";

import { listItems } from "@/core/lists/server";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { listDirectory, listMembers, sortMembers } from "@/modules/team";
import { InviteMemberDialog } from "@/modules/team/components/invite-member-dialog";
import { TeamTable } from "@/modules/team/components/team-table";

export const metadata: Metadata = { title: "People" };

/**
 * The Team screen (task 1.3, PRODUCT §4.16 "Team"). `team.view` opens it (Owner and Admins);
 * `team.manage` (the Owner) gets the email column and every action. Every person opens their
 * page (`/people/[id]`, kickoff 3): the Profile, and for the Owner their leave and attendance.
 */
export default async function PeoplePage() {
  const viewer = await requirePermission("team.view");
  const canManage = can(viewer.role, "team.manage");
  const [members, jobTitleOptions] = await Promise.all([
    canManage ? listMembers() : listDirectory(),
    listItems("job_title"),
  ]);
  const jobTitles = jobTitleOptions.map(({ id, name, archived_at }) => ({
    id,
    name,
    archived: archived_at !== null,
  }));

  const description = canManage
    ? "Invite people, set roles and job titles, deactivate or reactivate."
    : "Everyone on the team, with their role and job title.";

  return (
    <>
      <PageHeader
        title="People"
        description={description}
        help={description}
        actions={canManage ? <InviteMemberDialog jobTitles={jobTitles} /> : undefined}
      />
      <TeamTable members={sortMembers(members)} viewer={{ id: viewer.id, canManage }} />
    </>
  );
}
