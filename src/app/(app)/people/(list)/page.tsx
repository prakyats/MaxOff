import type { Metadata } from "next";

import { listItems } from "@/core/lists/server";
import { startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { bookedByWord } from "@/core/lib/booking-words";
import { formatIST, istDayStart, systemClock, todayIST } from "@/core/time";
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
import { type TeamToday, TeamTable } from "@/modules/team/components/team-table";
import {
  buildCrew,
  DEFAULT_EVENT_COLOR,
  listAvailability,
  listPeopleGlance,
  nextBookedLine,
  onLeaveLine,
  type TeamLine,
  teamToday,
} from "@/modules/calendar";
import { listTaskTypes, taskTypeColor } from "@/modules/tasks";

/** How far "Next booked" looks (v6.5 Q4): 30 days, then "Nothing booked". */
const NEXT_BOOKED_DAYS = 30;

/** Each line's dot tone when it is not a booking (whose dot is its type's colour). */
const TODAY_TONE: Record<TeamLine["kind"], TeamToday["tone"]> = {
  booked: "info",
  free: "success",
  leave: "neutral",
  half: "attention",
};

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
  // PP-admin-10, v6.5 unit 13: an Admin's "Today" (what each person is on: "Shoot 2:00 pm – 4:00 pm
  // · you", "Free all day", "On leave", "Half day") from member_availability(), and "Next booked"
  // from member_next_booking() (availability.view: never a title, client or location), read with
  // the list in one wave. The Owner's People page is unchanged (the plan: the board is theirs).
  const wantsToday = !canManage && can(viewer.role, "availability.view");
  const day = todayIST();
  const [allMembers, jobTitleOptions, currentCoordinators, days, upcoming, types] =
    await Promise.all([
      canManage ? full : directory,
      titles,
      coordinatorIds,
      wantsToday ? listAvailability(day, day, null) : Promise.resolve([]),
      wantsToday ? listPeopleGlance(day, NEXT_BOOKED_DAYS) : Promise.resolve([]),
      wantsToday ? listTaskTypes() : Promise.resolve([]),
    ]);
  // PP-admin-11: an Admin's list opens on the active people, "Show all" one quiet tap away (a view
  // control: the address is replaced, never history). The Owner's shows everyone, as before.
  const showAll = canManage || params.all === "1";
  const members = showAll ? allMembers : allMembers.filter((member) => member.status === "active");
  const hidden = allMembers.length - members.length;
  const today: Record<string, TeamToday> = {};
  const nextBooked: Record<string, string> = {};
  if (wantsToday) {
    const owner = allMembers.find(
      (member) => member.role === "owner" && member.status === "active",
    );
    const crew = buildCrew({
      scope: "admin",
      viewerId: viewer.id,
      owner: owner ? { id: owner.id, name: owner.fullName } : null,
      people: allMembers
        .filter((member) => member.status === "active" && member.role !== "owner")
        .map((member) => ({ id: member.id, name: member.fullName })),
      types: types.map((type) => ({
        id: type.id,
        name: type.name,
        color: taskTypeColor(type.color),
      })),
      nameOf: (memberId) => allMembers.find((member) => member.id === memberId)?.fullName ?? null,
      fallbackColor: DEFAULT_EVENT_COLOR,
      events: [],
      leave: [],
      availability: days,
    });
    const dayName = (date: string) => formatIST(istDayStart(date), "EEE d");
    // The same one call (member_people_glance) says when someone on leave is back (sample "4").
    const backOn = new Map(upcoming.map((row) => [row.memberId, row.backOn]));
    for (const line of crew ? teamToday(crew, day, systemClock()).lines : []) {
      today[line.memberId] = {
        label:
          line.kind === "leave"
            ? onLeaveLine(backOn.get(line.memberId) ?? null, dayName)
            : [line.text, line.by].filter(Boolean).join(" · ") +
              (line.more > 0 ? ` +${line.more}` : ""),
        tone: TODAY_TONE[line.kind],
        color: line.kind === "booked" ? line.color : null,
      };
    }
    for (const row of upcoming) {
      if (!row.onDate) continue;
      nextBooked[row.memberId] = nextBookedLine(
        {
          memberId: row.memberId,
          onDate: row.onDate,
          startAt: row.startAt,
          endAt: row.endAt,
          typeName: row.typeName,
          by: bookedByWord(
            { id: row.bookedById, name: row.bookedByName },
            viewer.id,
            owner?.id ?? null,
          ),
        },
        dayName,
      );
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
        today={wantsToday ? today : null}
        nextBooked={wantsToday ? nextBooked : null}
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
