import type { Metadata } from "next";

import { listItems } from "@/core/lists/server";
import { startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { systemClock, todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { ViewLink } from "@/core/ui/composites/view-link";
import {
  coordinatorOptions,
  listCurrentCoordinators,
  listDirectory,
  listMembers,
  sortMembers,
} from "@/modules/team";
import { AddPersonDialog } from "@/modules/team/components/add-person-dialog";
import { TeamTable } from "@/modules/team/components/team-table";
import { listAvailability } from "@/modules/tasks";

import { todayStatus, type TodayStatus } from "./today-status";

export const metadata: Metadata = { title: "People" };

/**
 * The Team screen (task 1.3, PRODUCT §4.16 "Team"). `team.view` opens it (Owner and Admins);
 * `team.manage` (the Owner) gets the email column and every action, and "Add person": an
 * employee (invite) or a freelancer with a coordinator (4C, ADR-0013). Every person opens their
 * page (`/people/[id]`, kickoff 3): the Profile, and for the Owner their leave and attendance.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Both shapes of the list and the titles start with the session read (ARCHITECTURE §19); the
  // role picks one, and RLS decides what each returns.
  const full = listMembers();
  const directory = listDirectory();
  const titles = listItems("job_title");
  const coordinatorIds = listCurrentCoordinators();
  startEarly(full, directory, titles, coordinatorIds);
  const [viewer, params] = await Promise.all([requirePermission("team.view"), searchParams]);
  const canManage = can(viewer.role, "team.manage");
  // PP-admin-10: an Admin's "Today" (available, on leave, a half day, busy) from
  // member_availability() (availability.view: never a pending request or a title), read with the
  // list in this page's own loader, everyone the Admin may see at once. The Owner has the board.
  const wantsToday = !canManage && can(viewer.role, "availability.view");
  const [allMembers, jobTitleOptions, currentCoordinators, days] = await Promise.all([
    canManage ? full : directory,
    titles,
    coordinatorIds,
    wantsToday ? listAvailability([todayIST()]) : Promise.resolve([]),
  ]);
  // PP-admin-11: an Admin's list opens on the active people, "Show all" one quiet tap away (a view
  // control: the address is replaced, never history). The Owner's shows everyone, as before.
  const showAll = canManage || params.all === "1";
  const members = showAll ? allMembers : allMembers.filter((member) => member.status === "active");
  const hidden = allMembers.length - members.length;
  const today: Record<string, TodayStatus> = {};
  if (wantsToday) {
    const now = systemClock();
    for (const member of members) {
      if (member.status !== "active") continue;
      const status = todayStatus(
        days.find((day) => day.memberId === member.id),
        now,
        member.role === "owner",
      );
      if (status) today[member.id] = status;
    }
  }
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
        today={canManage ? null : today}
      />
      {canManage || (hidden === 0 && !showAll) ? null : (
        <p className="mt-2 flex justify-center">
          <ViewLink
            href={showAll ? "/people" : "/people?all=1"}
            scroll={false}
            data-slot="people-show-all"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-3 text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2"
          >
            {showAll ? "Show active only" : `Show all · ${hidden} more`}
          </ViewLink>
        </p>
      )}
    </>
  );
}
