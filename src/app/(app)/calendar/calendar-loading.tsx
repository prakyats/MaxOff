import type { ISODate } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";

import type { SkeletonParts } from "../skeleton-parts";
import { CALENDAR_HELP } from "./copy";

/**
 * The calendar as it opens (6.4b; ARCHITECTURE §14.1, Kickoff 6 decision 25): on a phone the
 * header row, the compact month with today's month's rows, the handle and the day's heading; from
 * `md` up the view control and the pager, then the month; the Owner's and Admins' All · Tasks ·
 * Client work switch where the screen has it. The rows are today's month's (the calendar opens on
 * it), so the grid has the page's height. One component for the route's `loading.tsx` and its tap
 * drawing (v7.0), whose `month` is null: a drawing names no date.
 */
export function CalendarLoading({
  parts,
  weeks,
  month,
  switcher,
}: {
  parts: Pick<SkeletonParts, "CalendarSkeleton">;
  weeks: number;
  month: ISODate | null;
  switcher: boolean;
}) {
  const { CalendarSkeleton } = parts;
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
        <CalendarSkeleton weeks={weeks} month={month} switcher={switcher} />
        <span className="sr-only">Loading Calendar</span>
      </div>
    </>
  );
}
