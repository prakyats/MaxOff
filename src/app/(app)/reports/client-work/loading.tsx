import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { OWNER_CUSTOM_MAX_DAYS } from "@/modules/reports";
import { PendingPeriodControls } from "@/modules/reports/components/pending-period-controls";

import { CLIENT_WORK_DESCRIPTION } from "../copy";
import { ClientWorkSkeleton } from "./client-work-skeleton";

/**
 * Client work, traced (ARCHITECTURE §14.1): the same header, the period switch (the period the
 * address asks for) and its pager row, then the page's own skeleton (`ClientWorkSkeleton`, also its
 * `<Suspense>` fallback).
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="Client work"
        description={CLIENT_WORK_DESCRIPTION}
        help={CLIENT_WORK_DESCRIPTION}
      />
      <PendingPeriodControls
        today={todayIST()}
        base="/reports/client-work"
        maxDays={OWNER_CUSTOM_MAX_DAYS}
        fallback="month"
      />
      <ClientWorkSkeleton slot="loading-client-work-route" />
    </>
  );
}
