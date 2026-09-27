import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * A person's Profile (3.4) under the layout's header and tabs (which stay painted), traced card
 * for card: the avatar with the role and status chip, the facts (phone; for the Owner also sign-in and joined),
 * then the Profile record's heading (with Edit for the Owner, the same member check as the page)
 * and its three values (name, role, job title), each a label line over a value line.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const canEdit = member !== null && can(member.role, "team.manage");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading their profile"
      data-slot="loading-profile"
      className="flex max-w-xl flex-col gap-4"
    >
      <Card aria-hidden>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </div>
          <FieldLines count={canEdit ? 3 : 1} />
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
