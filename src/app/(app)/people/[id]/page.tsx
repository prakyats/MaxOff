import type { Metadata } from "next";

import { displayName } from "@/core/lib/display-name";
import { checkThenRead, startEarly } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { listItems } from "@/core/lists/server";
import { can } from "@/core/permissions";
import { fileUrl } from "@/core/storage";
import { formatIST, todayIST } from "@/core/time";
import { getMonthSummary, monthLabel, monthOf } from "@/modules/attendance";
import { getCompBalance } from "@/modules/leave";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/core/ui/primitives/avatar";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { initialsOf } from "@/core/ui/shell/viewer";
import {
  type CoordinatorSpell,
  listCoordinatorHistory,
  listDirectory,
  STATUS_LABELS,
  type TeamMember,
} from "@/modules/team";
import { ChangeCoordinatorButton } from "@/modules/team/components/coordinator-dialogs";
import { MemberProfile } from "@/modules/team/components/member-profile";

import { loadPerson, showsHistory } from "./person";
import { PersonSummary } from "./person-summary";

/** The tab names the person ("Prishit Shetty · MaxOff"), from the page's cached read (`loadPerson`). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { person } = await loadPerson((await params).id);
  return { title: displayName(person.fullName) };
}

/**
 * A person's Profile (kickoff 3, task 3.4): the first view of their page for everyone with
 * `team.view`. Who they are and how to reach them, then name, role and job title through the
 * edit pattern (`MemberProfile`: Edit for the Owner, read-only for an Admin). Reached from
 * People; a real drill-down, so back returns there (ARCHITECTURE §14.2 b). The header, the ⋯
 * menu and the tabs are the layout's.
 */
export default async function PersonProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Archived titles travel too: the person keeps the one they have (1.3 follow-up). Read
  // together with the person, not after (ARCHITECTURE §19).
  // A freelancer's coordinators, now and before, with the names they need (ADR-0013, 4C):
  // `team.view` reads both; they are read with the rest, not after.
  const personRead = loadPerson(id);
  const othersRead = Promise.all([
    listItems("job_title", { includeArchived: true }),
    listCoordinatorHistory(id),
    listDirectory(),
  ]);
  startEarly(personRead, othersRead);
  // PP-person-3 (major change 8): for the Owner, the summary's reads (the month's days waiting
  // and leave, the comp leave left), started once the viewer is known (the layout's read,
  // `cache()`d) while the person's reads run; used only for someone with attendance.
  const month = monthOf(todayIST());
  const owner = can((await requirePermission("team.view")).role, "attendance.view_all");
  const summaryRead = owner
    ? Promise.all([getMonthSummary(month, id), getCompBalance(id)])
    : Promise.resolve(null);
  startEarly(summaryRead);
  const [{ viewer, person }, [titles, spells, directory]] = await checkThenRead(
    personRead,
    othersRead,
  );
  const canManage = can(viewer.role, "team.manage");
  const jobTitles = titles.map(({ id: titleId, name, archived_at }) => ({
    id: titleId,
    name,
    archived: archived_at !== null,
  }));
  const since = person.joinedAt ?? person.invitedAt;
  const summary = showsHistory(viewer, person) ? await summaryRead : null;
  const [monthRow] = summary?.[0] ?? [];

  return (
    <div className="flex flex-col gap-4" data-slot="person-profile">
      {summary ? (
        <PersonSummary
          memberId={person.id}
          waiting={monthRow?.pendingDays ?? 0}
          leave={monthRow?.leaveDays ?? 0}
          compLeft={summary[1].availableDays}
          monthName={monthLabel(month).split(" ")[0] ?? "This month"}
        />
      ) : null}
      {/* PP-person-2: one details card, its facts in the shared field grid (a cell each, a small
          label over the value), then the Profile record; the role and status are not repeated. */}
      <Card>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex min-w-0 items-start gap-4">
            <Avatar size="lg" className="mt-1">
              {person.avatarFileId ? (
                <AvatarImage src={fileUrl(person.avatarFileId)} alt="" />
              ) : null}
              <AvatarFallback>{initialsOf(person.fullName)}</AvatarFallback>
            </Avatar>
            <dl
              className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))] gap-x-4 gap-y-3"
              data-slot="person-facts"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground text-xs">Phone</dt>
                <dd className="font-medium">
                  {person.phone ? (
                    <a
                      href={`tel:${person.phone.replace(/\s+/g, "")}`}
                      className="pressable-row inline-flex min-h-11 min-w-11 items-center underline underline-offset-4 md:min-h-0"
                    >
                      {person.phone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground font-normal">Not added</span>
                  )}
                </dd>
              </div>
              {person.email ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-muted-foreground text-xs">Signs in as</dt>
                  <dd className="font-medium break-all">{person.email}</dd>
                </div>
              ) : null}
              {since ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-muted-foreground text-xs">
                    {person.engagement === "freelance"
                      ? "Added"
                      : person.joinedAt
                        ? "Joined"
                        : "Invited"}
                  </dt>
                  <dd className="font-medium">{formatIST(since, "d MMM yyyy")}</dd>
                </div>
              ) : null}
              {/* The header carries the status chip from md; a phone reads it here. */}
              <div className="flex min-w-0 flex-col items-start gap-0.5 md:hidden">
                <dt className="text-muted-foreground text-xs">Status</dt>
                <dd>
                  <StatusBadge status={person.status} label={STATUS_LABELS[person.status]} />
                </dd>
              </div>
            </dl>
          </div>
          <Separator />
          <MemberProfile
            member={person}
            viewer={{ id: viewer.id, canManage }}
            jobTitles={jobTitles}
          />
        </CardContent>
      </Card>
      {person.engagement === "freelance" || spells.length > 0 ? (
        <CoordinatorCard
          person={person}
          spells={spells}
          names={new Map(directory.map((member) => [member.id, member.fullName]))}
          canManage={canManage}
        />
      ) : null}
    </div>
  );
}

/**
 * Who looks after a freelancer, and who did before (ADR-0013, WORKFLOWS §1b): the current
 * coordinator with "Change coordinator" for the Owner, then the earlier ones with their dates and
 * the reason (the Owner's and Admins' only, Kickoff 4 decision 20; RLS gives it to `team.view`).
 * Someone who became an employee keeps the history of their freelance time.
 */
function CoordinatorCard({
  person,
  spells,
  names,
  canManage,
}: {
  person: TeamMember;
  spells: readonly CoordinatorSpell[];
  names: ReadonlyMap<string, string>;
  canManage: boolean;
}) {
  const current = spells.find((spell) => spell.toAt === null) ?? null;
  const earlier = spells.filter((spell) => spell !== current);
  const freelance = person.engagement === "freelance";
  const name = (spell: CoordinatorSpell) => names.get(spell.coordinatorId) ?? "Someone";
  return (
    <Card data-slot="person-coordinator">
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-medium">
              {freelance ? "Coordinator" : "Coordinators as a freelancer"}
            </h2>
            {freelance ? (
              <p data-slot="person-coordinator-current">
                {current ? (
                  <>
                    <span className="font-medium">{name(current)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · since {formatIST(current.fromAt, "d MMM yyyy")}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    Nobody now. Set one before they are reactivated.
                  </span>
                )}
              </p>
            ) : null}
            {current?.reason ? (
              <p className="text-muted-foreground break-words">{current.reason}</p>
            ) : null}
          </div>
          {canManage && freelance ? <ChangeCoordinatorButton member={person} /> : null}
        </div>
        {earlier.length > 0 ? (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-xs font-medium">
                {freelance ? "Before" : "History"}
              </h3>
              <ol className="flex flex-col gap-3" data-slot="person-coordinator-history">
                {earlier.map((spell) => (
                  <li key={spell.id} className="flex flex-col gap-0.5">
                    <p>
                      <span className="font-medium">{name(spell)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatIST(spell.fromAt, "d MMM yyyy")} to{" "}
                        {spell.toAt ? formatIST(spell.toAt, "d MMM yyyy") : "now"}
                      </span>
                    </p>
                    {spell.reason ? (
                      <p className="text-muted-foreground break-words">{spell.reason}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
