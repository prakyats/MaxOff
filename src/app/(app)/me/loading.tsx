import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { LoadingState, PageLoading } from "@/core/ui/composites/loading-state";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * My profile is one record: an avatar block and labelled fields. Whoever marks attendance also
 * gets the "Attendance & leave" row under it (2.3), traced here so it does not push the page
 * down when it arrives. Same member check as `my-day/loading.tsx`.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const leaveRow = member !== null && can(member.role, "attendance.self");
  return (
    <PageLoading title="Me" shape="detail">
      <div className="flex max-w-xl flex-col gap-4">
        <LoadingState shape="detail" label="Loading Me" />
        {leaveRow ? (
          <div
            data-slot="loading-me-leave-link"
            aria-hidden
            className="bg-card ring-foreground/10 flex min-h-14 items-center justify-between gap-4 rounded-xl px-4 py-3 ring-1"
          >
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3.5 w-64 max-w-full" />
            </div>
            <Skeleton className="size-4 shrink-0 rounded-sm" />
          </div>
        ) : null}
      </div>
    </PageLoading>
  );
}
