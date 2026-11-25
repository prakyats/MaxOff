import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";

import { STAGES_DESCRIPTION } from "../copy";
import { PeriodControls } from "../period-controls";
import { StagesSkeleton } from "./stages-skeleton";

/**
 * Stage durations, traced (ARCHITECTURE §14.1): the same header, the period switch (nothing chosen
 * yet) and its pager row, then the page's own skeleton (`StagesSkeleton`, also its `<Suspense>`
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
      <PeriodControls period={null} today={todayIST()} base="/reports/stages" />
      <StagesSkeleton slot="loading-stages-route" />
    </>
  );
}
