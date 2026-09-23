import type { Metadata } from "next";

import { listOptions } from "@/core/lists/server";
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
 * `team.manage` (the Owner) gets the email column and every action. Attendance and leave per
 * person join in phase 2.
 */
export default async function PeoplePage() {
  const viewer = await requirePermission("team.view");
  const canManage = can(viewer.role, "team.manage");
  const [members, jobTitleOptions] = await Promise.all([
    canManage ? listMembers() : listDirectory(),
    listOptions("job_title"),
  ]);
  const jobTitles = jobTitleOptions.map(({ id, name }) => ({ id, name }));

  return (
    <>
      <PageHeader
        title="People"
        description={
          canManage
            ? "Invite people, set roles and job titles, deactivate or reactivate."
            : "Everyone on the team, with their role and job title."
        }
        actions={canManage ? <InviteMemberDialog jobTitles={jobTitles} /> : undefined}
      />
      <TeamTable
        members={sortMembers(members)}
        viewer={{ id: viewer.id, canManage }}
        jobTitles={jobTitles}
      />
    </>
  );
}
