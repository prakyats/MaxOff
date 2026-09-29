import type { Metadata } from "next";

import { listItems } from "@/core/lists/server";
import { startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  coordinatorOptions,
  listCurrentCoordinators,
  listDirectory,
  listMembers,
  sortMembers,
} from "@/modules/team";
import { AddPersonDialog } from "@/modules/team/components/add-person-dialog";
import { TeamTable } from "@/modules/team/components/team-table";

export const metadata: Metadata = { title: "People" };

/**
 * The Team screen (task 1.3, PRODUCT §4.16 "Team"). `team.view` opens it (Owner and Admins);
 * `team.manage` (the Owner) gets the email column and every action, and "Add person": an
 * employee (invite) or a freelancer with a coordinator (4C, ADR-0013). Every person opens their
 * page (`/people/[id]`, kickoff 3): the Profile, and for the Owner their leave and attendance.
 */
export default async function PeoplePage() {
  // Both shapes of the list and the titles start with the session read (ARCHITECTURE §19); the
  // role picks one, and RLS decides what each returns.
  const full = listMembers();
  const directory = listDirectory();
  const titles = listItems("job_title");
  const coordinatorIds = listCurrentCoordinators();
  startEarly(full, directory, titles, coordinatorIds);
  const viewer = await requirePermission("team.view");
  const canManage = can(viewer.role, "team.manage");
  const [members, jobTitleOptions, currentCoordinators] = await Promise.all([
    canManage ? full : directory,
    titles,
    coordinatorIds,
  ]);
  // A freelancer is named with their coordinator (ADR-0013); `team.view` reads every current row.
  const names = new Map(members.map((member) => [member.id, member.fullName]));
  const coordinators = Object.fromEntries(
    Object.entries(currentCoordinators).flatMap(([freelancer, coordinator]) => {
      const name = names.get(coordinator);
      return name ? [[freelancer, name]] : [];
    }),
  );
  const jobTitles = jobTitleOptions.map(({ id, name, archived_at }) => ({
    id,
    name,
    archived: archived_at !== null,
  }));

  const description = canManage
    ? "Add employees and freelancers, set roles and job titles, deactivate or reactivate."
    : "Everyone on the team, with their role and job title.";

  return (
    <>
      <PageHeader
        title="People"
        description={description}
        help={description}
        actions={
          canManage ? (
            <AddPersonDialog jobTitles={jobTitles} coordinators={coordinatorOptions(members)} />
          ) : undefined
        }
      />
      <TeamTable
        members={sortMembers(members)}
        viewer={{ id: viewer.id, canManage }}
        coordinators={coordinators}
      />
    </>
  );
}
