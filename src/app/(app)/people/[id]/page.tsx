import type { Metadata } from "next";

import { listItems } from "@/core/lists/server";
import { can } from "@/core/permissions";
import { fileUrl } from "@/core/storage";
import { formatIST } from "@/core/time";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/core/ui/primitives/avatar";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { initialsOf } from "@/core/ui/shell/viewer";
import { ROLE_LABELS, STATUS_LABELS } from "@/modules/team";
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
  const { viewer, person } = await loadPerson(id);
  const canManage = can(viewer.role, "team.manage");
  // Archived titles travel too: the person keeps the one they have (1.3 follow-up).
  const jobTitles = (await listItems("job_title", { includeArchived: true })).map(
    ({ id: titleId, name, archived_at }) => ({ id: titleId, name, archived: archived_at !== null }),
  );
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
              <p className="truncate font-medium">{ROLE_LABELS[person.role]}</p>
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
                    className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
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
                <dt className="text-muted-foreground">{person.joinedAt ? "Joined" : "Invited"}</dt>
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
    </div>
  );
}
