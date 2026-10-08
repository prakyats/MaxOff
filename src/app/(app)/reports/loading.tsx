import { ArrowRightIcon } from "lucide-react";

import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { KpiCardSkeleton } from "@/modules/reports";

import { ADMIN_REPORT_DESCRIPTION, REPORTS_DESCRIPTION } from "./copy";
import {
  OWNER_REPORTS,
  REPORT_LINES_CLASS,
  REPORT_ROW_CLASS,
  REPORTS_LIST_CLASS,
} from "./list-row";
import { PeriodControls } from "./period-controls";

/**
 * Reports: the Owner's list of reports (3b.4: Month first, rows like Settings), traced in the
 * page's own list and row geometry (`list-row.ts`): each a line for the label over the
 * description's lines (its own words, unseen, so it wraps as the page does), and the arrow;
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
        <div role="status" aria-busy="true" aria-label="Loading reports">
          <ul aria-hidden data-slot="loading-reports-list" className={REPORTS_LIST_CLASS}>
            {OWNER_REPORTS.map((report) => (
              <li key={report.key} className={REPORT_ROW_CLASS}>
                <span className={REPORT_LINES_CLASS}>
                  <span className="flex h-5 items-center">
                    <Skeleton className="h-3.5 w-24" />
                  </span>
                  {/* The description's own words, unseen, each line a bar: it wraps to exactly the
                      page's lines at every width and text size. */}
                  <span className="text-sm">
                    <span className="bg-muted rounded-md box-decoration-clone text-transparent select-none motion-safe:animate-pulse">
                      {report.description}
                    </span>
                  </span>
                </span>
                <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
              </li>
            ))}
          </ul>
          <span className="sr-only">Loading reports</span>
        </div>
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
