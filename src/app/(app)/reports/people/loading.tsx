import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { PendingPeriodControls } from "@/modules/reports/components/pending-period-controls";
import { OWNER_CUSTOM_MAX_DAYS, DelayReportSkeleton, ReportHeading } from "@/modules/reports";

import { PEOPLE_DESCRIPTION } from "../copy";
import { PeopleSkeleton } from "./people-skeleton";

/**
 * The people report, traced (ARCHITECTURE §14.1): the same header, the period switch (the period the
 * address asks for) and its pager row, the "Tasks by person" heading (its own words) over four person cards of the
 * card's own shape with the attendance block (the report opens on this month), then the delays' heading and
 * its three pattern cards.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="People"
        description={PEOPLE_DESCRIPTION}
        help={PEOPLE_DESCRIPTION}
      />
      <PendingPeriodControls
        today={todayIST()}
        base="/reports/people"
        maxDays={OWNER_CUSTOM_MAX_DAYS}
        fallback="month"
      />
      <div className="flex min-w-0 flex-col gap-6" data-slot="loading-people-route-sections">
        <div className="flex min-w-0 flex-col gap-2">
          <ReportHeading id="loading-people-title">Tasks by person</ReportHeading>
          <PeopleSkeleton period={{ kind: "month" }} slot="loading-people-route" />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <ReportHeading id="loading-delays-title">Late and overdue tasks</ReportHeading>
          <DelayReportSkeleton />
        </div>
      </div>
    </>
  );
}
