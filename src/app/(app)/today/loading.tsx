import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { ApprovalGroupSkeleton } from "@/core/ui/composites/approval-group-skeleton";
import { PageHeader } from "@/core/ui/composites/page-header";
import { TodayAttendanceStripSkeleton, TodayCardSkeleton } from "@/modules/attendance";
import { DashSectionHeadingSkeleton } from "@/modules/dashboards";
import { TaskRowsSkeleton } from "@/modules/tasks";

import { adminGreeting, ownerGreeting } from "./words";

/**
 * Today as it renders (6.2, 6.3), traced per role (ARCHITECTURE §14.1). **The Owner's:** the
 * attendance card's four counts, then the Approvals section: its heading and a preview group's
 * heading and rows (no "Approve all" on Today). **An Admin's:** the one-line attendance strip,
 * then "Needs you": its heading and two `TaskRow`s. A Crew member who types the address is taken
 * to My Day, whose shape this is too (the strip and a section). The `(app)` layout already read
 * the member for this request (`cache()`), so asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const owner = member !== null && can(member.role, "attendance.view_all");
  const strip = member !== null && can(member.role, "attendance.self");
  return (
    <>
      <PageHeader
        title="Today"
        description={owner ? ownerGreeting(member?.name) : adminGreeting(member?.name)}
      />
      {owner ? <TodayCardSkeleton /> : null}
      {strip ? <TodayAttendanceStripSkeleton /> : null}
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Today"
        data-slot="loading-today"
        className="flex max-w-3xl min-w-0 flex-col gap-6"
      >
        <section className="flex min-w-0 flex-col gap-2">
          <DashSectionHeadingSkeleton />
          {owner ? (
            <ApprovalGroupSkeleton rows={2} bulk={false} />
          ) : (
            <TaskRowsSkeleton rows={2} notes={2} label="Needs you" />
          )}
        </section>
        <span className="sr-only">Loading Today</span>
      </div>
    </>
  );
}
