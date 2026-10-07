import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import { LoadingState } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { KpiCardSkeleton } from "@/modules/reports";

import { ADMIN_REPORT_DESCRIPTION, REPORTS_DESCRIPTION } from "./copy";
import { PeriodControls } from "./period-controls";

/**
 * Reports: the Owner's list of reports (3b.4: Month first, rows like Settings), traced as a list;
 * an Admin's work report (6.3), traced: the period control (nothing chosen yet) and its pager row,
 * the four KPI cards, and the load list's heading. The `(app)` layout already read the member for
 * this request (`cache()`).
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const owner = member !== null && can(member.role, "attendance.view_all");
  if (owner) {
    return (
      <>
        <PageHeader title="Reports" description={REPORTS_DESCRIPTION} help={REPORTS_DESCRIPTION} />
        <LoadingState shape="list" count={2} label="Loading reports" className="md:max-w-2xl" />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Reports" description={ADMIN_REPORT_DESCRIPTION} />
      <PeriodControls period={null} today={todayIST()} />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading your report"
        data-slot="loading-work-report"
        className="flex max-w-3xl min-w-0 flex-col gap-6"
      >
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((card) => (
            <KpiCardSkeleton key={card} />
          ))}
        </div>
        <div className="flex h-5 items-center">
          <Skeleton className="h-4 w-44" />
        </div>
        <span className="sr-only">Loading your report</span>
      </div>
    </>
  );
}
