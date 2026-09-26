import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageLoading } from "@/core/ui/composites/loading-state";
import { Card, CardContent, CardHeader } from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * Traces `page.tsx` card for card (ARCHITECTURE §14.1): the profile card with the avatar block,
 * the sign-in line, the read-only Profile record (its heading row with Edit, two label and value
 * rows, task 2.9), then the "Attendance & leave" row for whoever marks attendance (2.3), then
 * Appearance and Session. Same member check as `my-day/loading.tsx`.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const leaveRow = member !== null && can(member.role, "attendance.self");
  return (
    <PageLoading title="Me" shape="detail">
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Me"
        data-slot="loading-state"
        className="flex max-w-xl flex-col gap-4"
      >
        <Card aria-hidden>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-4 w-64 max-w-full" />
            <Separator />
            <div data-slot="loading-record">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-9 w-28 rounded-lg" />
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {[0, 1].map((row) => (
                  <div key={row} className="flex flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="h-4 w-44" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
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
        <Card aria-hidden>
          <CardContent className="flex flex-col gap-4">
            {[0, 1].map((row) => (
              <div key={row} className="flex flex-col gap-4">
                {row === 1 ? <Separator /> : null}
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3.5 w-52 max-w-full" />
                  </div>
                  <Skeleton className="h-9 w-24 rounded-lg" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <span className="sr-only">Loading Me</span>
      </div>
    </PageLoading>
  );
}
