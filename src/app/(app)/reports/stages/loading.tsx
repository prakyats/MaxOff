import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { OWNER_CUSTOM_MAX_DAYS } from "@/modules/reports";
import { PendingPeriodControls } from "@/modules/reports/components/pending-period-controls";

import { STAGES_DESCRIPTION } from "../copy";
import { StagesSkeleton } from "./stages-skeleton";

/**
 * Stage durations, traced (ARCHITECTURE §14.1): the same header, the period switch (the period the
 * address asks for) and its pager row, then the page's own skeleton (`StagesSkeleton`, also its `<Suspense>`
 * fallback).
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="Stage durations"
        description={STAGES_DESCRIPTION}
        help={STAGES_DESCRIPTION}
      />
      <PendingPeriodControls
        today={todayIST()}
        base="/reports/stages"
        maxDays={OWNER_CUSTOM_MAX_DAYS}
        fallback="month"
      />
      <StagesSkeleton slot="loading-stages-route" />
    </>
  );
}
