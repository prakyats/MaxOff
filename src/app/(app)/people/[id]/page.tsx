import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { listItems } from "@/core/lists/server";
import { can } from "@/core/permissions";
import { fileUrl } from "@/core/storage";
import { formatIST } from "@/core/time";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/core/ui/primitives/avatar";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { initialsOf } from "@/core/ui/shell/viewer";
import {
  type CoordinatorSpell,
  listCoordinatorHistory,
  listDirectory,
  roleLabel,
  STATUS_LABELS,
  type TeamMember,
} from "@/modules/team";
import { ChangeCoordinatorButton } from "@/modules/team/components/coordinator-dialogs";
import { MemberProfile } from "@/modules/team/components/member-profile";

import { loadPerson } from "./person";

export const metadata: Metadata = { title: "Person" };

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
  const [{ viewer, person }, [titles, spells, directory]] = await checkThenRead(
    loadPerson(id),
    Promise.all([
      listItems("job_title", { includeArchived: true }),
      listCoordinatorHistory(id),
      listDirectory(),
    ]),
  );
  const canManage = can(viewer.role, "team.manage");
  const jobTitles = titles.map(({ id: titleId, name, archived_at }) => ({
    id: titleId,
    name,
    archived: archived_at !== null,
  }));
  const since = person.joinedAt ?? person.invitedAt;

  return (
    <div className="flex max-w-xl flex-col gap-4" data-slot="person-profile">
      <Card>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar size="lg">
              {person.avatarFileId ? (
                <AvatarImage src={fileUrl(person.avatarFileId)} alt="" />
              ) : null}
              <AvatarFallback>{initialsOf(person.fullName)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col items-start gap-1">
              <p className="truncate font-medium">{roleLabel(person)}</p>
              <StatusBadge status={person.status} label={STATUS_LABELS[person.status]} />
            </div>
          </div>
          <dl className="flex flex-col gap-3" data-slot="person-facts">
            <div>
              <dt className="text-muted-foreground">Phone</dt>
              <dd className="font-medium">
                {person.phone ? (
                  <a
                    href={`tel:${person.phone.replace(/\s+/g, "")}`}
                    className="pressable-row inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
                  >
                    {person.phone}
                  </a>
                ) : (
                  <span className="text-muted-foreground font-normal">Not added</span>
                )}
              </dd>
            </div>
            {person.email ? (
              <div>
                <dt className="text-muted-foreground">Signs in as</dt>
                <dd className="font-medium break-all">{person.email}</dd>
              </div>
            ) : null}
            {since ? (
              <div>
                <dt className="text-muted-foreground">
                  {person.engagement === "freelance"
                    ? "Added"
                    : person.joinedAt
                      ? "Joined"
                      : "Invited"}
                </dt>
                <dd className="font-medium">{formatIST(since, "d MMM yyyy")}</dd>
              </div>
            ) : null}
          </dl>
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
