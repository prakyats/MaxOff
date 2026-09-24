import type { Metadata } from "next";

import { listItems } from "@/core/lists/server";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  InviteMemberDialog,
  listDirectory,
  listMembers,
  sortMembers,
  TeamTable,
} from "@/modules/team";

export const metadata: Metadata = { title: "People" };

/**
 * The Team screen (task 1.3, PRODUCT §4.16 "Team"). `team.view` opens it (Owner and Admins);
 * `team.manage` (the Owner) gets the email column and every action. With `attendance.view_all`
 * (the Owner, 2.4) each person opens their attendance and leave (`/people/[id]`).
 */
export default async function PeoplePage() {
  const viewer = await requirePermission("team.view");
  const canManage = can(viewer.role, "team.manage");
  // Archived titles travel too: the Edit dialog keeps showing the one a member already has
  // (it just isn't offered to anyone else), so editing a name never clears their title.
  const [members, jobTitleOptions] = await Promise.all([
    canManage ? listMembers() : listDirectory(),
    listItems("job_title", { includeArchived: true }),
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
      <TeamTable
        members={sortMembers(members)}
        viewer={{
          id: viewer.id,
          canManage,
          canViewAttendance: can(viewer.role, "attendance.view_all"),
        }}
        jobTitles={jobTitles}
      />
    </>
  );
}
