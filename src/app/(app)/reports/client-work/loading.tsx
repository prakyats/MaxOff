import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";

import { CLIENT_WORK_DESCRIPTION } from "../copy";
import { PeriodControls } from "../period-controls";
import { ClientWorkSkeleton } from "./client-work-skeleton";

/**
 * Client work, traced (ARCHITECTURE §14.1): the same header, the period switch (nothing chosen
 * yet) and its pager row, then the page's own skeleton (`ClientWorkSkeleton`, also its
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
      <PeriodControls period={null} today={todayIST()} base="/reports/client-work" />
      <ClientWorkSkeleton slot="loading-client-work-route" />
    </>
  );
}
