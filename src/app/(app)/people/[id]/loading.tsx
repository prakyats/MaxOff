import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { PersonSummarySkeleton } from "./person-summary";

/**
 * A person's Profile (3.4) under the layout's header and tabs (which stay painted), traced: for
 * the Owner the summary first (PP-person-3: days waiting, leave this month, comp leave left), then
 * the one details card (PP-person-2): the avatar beside the facts' field grid (phone; for the
 * Owner also sign-in and joined; on a phone the status), then the Profile record's heading (with
 * Edit for the Owner, the same member check as the page) and its three values (name, role, job
 * title), each a label line over a value line.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const canEdit = member !== null && can(member.role, "team.manage");
  const owner = member !== null && can(member.role, "attendance.view_all");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading their profile"
      data-slot="loading-profile"
      className="flex flex-col gap-4"
    >
      {owner ? <PersonSummarySkeleton /> : null}
      <Card aria-hidden>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex items-start gap-4">
            <Skeleton className="size-16 shrink-0 rounded-full" />
            <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))] gap-x-4 gap-y-3">
              {Array.from({ length: canEdit ? 3 : 1 }, (_, index) => (
                <Cell key={index} />
              ))}
              <div className="md:hidden">
                <Cell />
              </div>
            </div>
          </div>
          <Separator />
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Skeleton className="h-4 w-14" />
            {canEdit ? <Skeleton className="h-9 w-20 rounded-lg" /> : null}
          </div>
          <FieldLines count={3} />
        </CardContent>
      </Card>
      <span className="sr-only">Loading their profile</span>
    </div>
  );
}

/** A facts cell: the small label over its value. */
function Cell() {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex h-4 items-center">
        <Skeleton className="h-3 w-14" />
      </span>
      <span className="flex h-5 items-center">
        <Skeleton className="h-3.5 w-28 max-w-full" />
      </span>
    </div>
  );
}

function FieldLines({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-4 w-44" />
        </div>
      ))}
    </div>
  );
}
