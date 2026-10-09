import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { ApprovalRowsSkeleton } from "@/core/ui/composites/approval-group-skeleton";
import { PageHeader } from "@/core/ui/composites/page-header";
import { TodayAttendanceStripSkeleton, TodayCardSkeleton } from "@/modules/attendance";
import { DashSectionHeadingSkeleton, LinkRowsSkeleton } from "@/modules/dashboards";
import { TaskRowsSkeleton } from "@/modules/tasks";

import { adminGreeting, ownerGreeting } from "./words";

/**
 * Today as it renders (6.2, 6.3), traced per role (ARCHITECTURE §14.1). **The Owner's** (the Today
 * refresh, owner 2026-10-09): "Needs you", its heading and two compact approval rows (the same
 * row height, the kind label and title, the two meta lines, the one outlined button), then the
 * attendance section, its heading and the strip of four counts. Needs you always stands ("Nothing
 * needs you." when empty) and the card always follows it, so the first screen keeps this shape;
 * the sections after the card (Today's tasks, Client work, Overdue and risks, This week) are
 * hidden when empty (decision 24). **An Admin's:** the one-line attendance strip, then "Needs
 * you": its heading and two `TaskRow`s, then Client work (7.3): its heading and two rows. A Crew
 * member who types the address is taken to My Day, whose shape this is too (the strip and a
 * section). The `(app)` layout already read the member for this request (`cache()`), so asking
 * costs no query.
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
            <ApprovalRowsSkeleton rows={2} />
          ) : (
            <TaskRowsSkeleton rows={2} notes={2} label="Needs you" />
          )}
        </section>
        {owner ? (
          <TodayCardSkeleton />
        ) : (
          // The Admin's Client work (7.3): its heading and two item rows (title over the project ·
          // client · date line); the Mark done button sits where the chevron is.
          <section className="flex min-w-0 flex-col gap-2" data-slot="loading-today-client-work">
            <DashSectionHeadingSkeleton width="w-24" />
            <LinkRowsSkeleton rows={2} detail />
          </section>
        )}
        <span className="sr-only">Loading Today</span>
      </div>
    </>
  );
}
