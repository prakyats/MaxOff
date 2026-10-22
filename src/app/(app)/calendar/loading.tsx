import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { CalendarSkeleton, monthGrid } from "@/modules/calendar";

import { CALENDAR_HELP } from "./copy";

/**
 * The calendar as it opens (6.4b; ARCHITECTURE §14.1, Kickoff 6 decision 25): on a phone the
 * header row, the compact month with today's month's rows, the handle and the day's heading; from
 * `md` up the view control and the pager, then the month; the Owner's and Admins' All · Tasks ·
 * Client work switch where the screen has it. The rows are today's month's (the
 * calendar opens on it), so the grid has the page's height.
 */
export default async function Loading() {
  const weeks = monthGrid(todayIST()).weeks.length;
  // The `(app)` layout already read the member (`cache()`), so asking costs no query. The switch
  // is the Owner's and Admins' (`scopeFor`: whoever sees others' availability).
  const member = await getCurrentMember();
  const switcher =
    member !== null &&
    (can(member.role, "attendance.view_all") || can(member.role, "availability.view"));
  return (
    <>
      <PageHeader title="Calendar" help={CALENDAR_HELP} />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Calendar"
        data-slot="loading-calendar"
        className="min-w-0"
      >
        <CalendarSkeleton weeks={weeks} switcher={switcher} />
        <span className="sr-only">Loading Calendar</span>
      </div>
    </>
  );
}
