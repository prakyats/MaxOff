import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { EodReportSkeleton } from "@/modules/reports";

import { EOD_REPORT_DESCRIPTION } from "../copy";

/**
 * One day's end-of-day report (6.5), traced: the header with its back, the day line, the live
 * note's line (today and yesterday carry one; a saved day's report starts there instead), then
 * the Attendance section: its heading, its counts line and two person rows (`EodReportSkeleton`).
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        back={{ href: "/reports/end-of-day", label: "End of day" }}
        title="End of day"
        description={EOD_REPORT_DESCRIPTION}
        help={EOD_REPORT_DESCRIPTION}
      />
      <div role="status" aria-busy="true" aria-label="Loading the report" data-slot="loading-eod">
        <div data-slot="eod-date" className="mb-2 flex h-5 items-center">
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="mb-4 flex h-5 items-center">
          <Skeleton className="h-3.5 w-52 max-w-full" />
        </div>
        <EodReportSkeleton />
      </div>
    </>
  );
}
