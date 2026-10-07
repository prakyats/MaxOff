import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { cn } from "@/core/lib/utils";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { CalendarControlsSkeleton, CalendarRowsSkeleton } from "@/modules/calendar";

import { CALENDAR_DESCRIPTION } from "./copy";

/**
 * The calendar as it renders (6.4), traced (ARCHITECTURE §14.1; the shape the owner named at the
 * 3c review: a week strip of days above a column of blocks, `loading-day-strip`): the view
 * switcher, the pager row, the seven chips of the week strip, the filters (four for the Owner and
 * Admins, one for Crew), then the day's heading and two event rows. The `(app)` layout already read
 * the member for this request (`cache()`), so asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const filters = member !== null && can(member.role, "availability.view") ? 4 : 1;
  return (
    <>
      <PageHeader title="Calendar" description={CALENDAR_DESCRIPTION} help={CALENDAR_DESCRIPTION} />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Calendar"
        data-slot="loading-day-strip"
        className="flex max-w-3xl min-w-0 flex-col gap-3"
      >
        <CalendarControlsSkeleton />
        <div
          aria-hidden
          data-slot="calendar-filters"
          className={cn(
            "grid gap-3",
            filters === 1 ? "grid-cols-1 md:w-80" : "grid-cols-2 md:grid-cols-4",
          )}
        >
          {Array.from({ length: filters }, (_, index) => (
            <div key={index} className="flex min-w-0 flex-col gap-1.5">
              <span className="flex h-3.5 items-center">
                <Skeleton className="h-3 w-12" />
              </span>
              <Skeleton className="h-11 w-full rounded-lg md:h-8" />
            </div>
          ))}
        </div>
        <div className="mt-1">
          <CalendarRowsSkeleton />
        </div>
        <span className="sr-only">Loading Calendar</span>
      </div>
    </>
  );
}
