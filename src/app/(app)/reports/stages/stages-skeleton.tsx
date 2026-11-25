import { CARD_GRID_CLASS, ReportHeading, StageCardSkeleton } from "@/modules/reports";

/**
 * The stage durations while they load: "Every project" over one card of stage rows, then "By
 * project" over two project cards (a title, a client line and their rows), in the page's own
 * section and grid classes.
 */
export function StagesSkeleton({
  slot = "loading-stages-report",
}: {
  /** The route's `loading.tsx` passes its own, so the page's streamed fallback is the only one. */
  slot?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6" role="status" aria-busy="true" data-slot={slot}>
      <span className="sr-only">Loading the stage durations</span>
      <div className="flex min-w-0 flex-col gap-2">
        <ReportHeading id="loading-stages-overall">Every project</ReportHeading>
        <StageCardSkeleton rows={4} />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <ReportHeading id="loading-stages-projects">By project</ReportHeading>
        <div className={CARD_GRID_CLASS}>
          <StageCardSkeleton rows={3} title />
          <StageCardSkeleton rows={3} title />
        </div>
      </div>
    </div>
  );
}
