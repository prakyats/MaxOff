import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageHeader } from "@/core/ui/composites/page-header";
import { TodayAttendanceStripSkeleton } from "@/modules/attendance";
import { DashSectionHeadingSkeleton } from "@/modules/dashboards";
import { TaskRowsSkeleton } from "@/modules/tasks";

import { myDayGreeting } from "./words";

/**
 * My Day as it renders (6.1), traced (ARCHITECTURE §14.1): the one-line attendance strip first
 * (`TodayAttendanceStripSkeleton`, ROADMAP 6.1), then the first exception section: its heading
 * and two `TaskRow`s (`TaskRowsSkeleton`), the shape every section under the strip shares. The
 * `(app)` layout already read the member for this request (`cache()`), so asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const strip = member !== null && can(member.role, "attendance.self");
  return (
    <>
      <PageHeader title="My Day" description={myDayGreeting(member?.name)} />
      {strip ? <TodayAttendanceStripSkeleton /> : null}
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading My Day"
        data-slot="loading-my-day"
        className="flex max-w-3xl min-w-0 flex-col gap-6"
      >
        <section className="flex min-w-0 flex-col gap-2">
          <DashSectionHeadingSkeleton />
          <TaskRowsSkeleton rows={2} label="Your tasks" />
        </section>
        <span className="sr-only">Loading My Day</span>
      </div>
    </>
  );
}
