import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { CalendarSkeleton, monthGrid } from "@/modules/calendar";

import { CALENDAR_HELP } from "./copy";

/**
 * The calendar as it opens (6.4b; ARCHITECTURE §14.1, Kickoff 6 decision 25): on a phone the
 * header row, the compact month with today's month's rows, the handle and the day's heading; from
 * `md` up the view control and the pager, then the month. The rows are today's month's (the
 * calendar opens on it), so the grid has the page's height.
 */
export default function Loading() {
  const weeks = monthGrid(todayIST()).weeks.length;
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
        <CalendarSkeleton weeks={weeks} />
        <span className="sr-only">Loading Calendar</span>
      </div>
    </>
  );
}
