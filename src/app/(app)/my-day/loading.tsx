import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageHeader } from "@/core/ui/composites/page-header";
import { TodayAttendanceStripSkeleton } from "@/modules/attendance";
import { todayIST } from "@/core/time";
import {
  dateLine,
  DashSectionHeadingSkeleton,
  DayColumns,
  dayContext,
  PhoneDateLine,
  ThisWeekSkeleton,
} from "@/modules/dashboards";
import { TaskRowsSkeleton } from "@/modules/tasks";

/**
 * My Day as it renders (6.1), traced (ARCHITECTURE §14.1): the one-line attendance strip first
 * (`TodayAttendanceStripSkeleton`, ROADMAP 6.1), then the first exception section: its heading
 * and two `TaskRow`s (`TaskRowsSkeleton`), the shape every section under the strip shares; the
 * date line, and "This week" as the right column from a 1200 px content width (`DayColumns`, V5b
 * major change 1). The `(app)` layout already read the member for this request (`cache()`), so
 * asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const strip = member !== null && can(member.role, "attendance.self");
  const today = todayIST();
  return (
    <>
      <PageHeader title="My Day" description={dayContext(today, member?.name)} />
      <PhoneDateLine line={dateLine(today)} />
      {strip ? <TodayAttendanceStripSkeleton /> : null}
      <DayColumns
        slot="loading-my-day"
        loading="Loading My Day"
        week={<ThisWeekSkeleton />}
        main={
          <>
            <section className="flex min-w-0 flex-col gap-2">
              <DashSectionHeadingSkeleton />
              <TaskRowsSkeleton rows={2} label="Your tasks" />
            </section>
            <span className="sr-only">Loading My Day</span>
          </>
        }
      />
    </>
  );
}
