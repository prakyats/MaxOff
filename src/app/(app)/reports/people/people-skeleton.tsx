import { CARD_GRID_CLASS, type Period, PersonCardSkeleton } from "@/modules/reports";

import { ATTENDANCE_LINE_COUNT } from "./attendance-lines";

/**
 * The people's cards while they load: the employees' block (its label, as the page's) over four
 * cards of the card's own shape, with the attendance block in the Month view.
 */
export function PeopleSkeleton({
  period,
  slot = "loading-people-report",
}: {
  period: Pick<Period, "kind">;
  /** The route's `loading.tsx` passes its own, so the page's streamed fallback is the only one. */
  slot?: string;
}) {
  const attendance = period.kind === "month" ? ATTENDANCE_LINE_COUNT : 0;
  return (
    <div className="flex min-w-0 flex-col gap-4" role="status" aria-busy="true" data-slot={slot}>
      <span className="sr-only">Loading the people report</span>
      <div className="flex min-w-0 flex-col gap-2">
        {/* The employees' block label, as the page draws it. */}
        <h3 className="text-muted-foreground text-xs font-medium">Employees</h3>
        <div className={CARD_GRID_CLASS}>
          {[0, 1, 2, 3].map((card) => (
            <PersonCardSkeleton key={card} attendance={attendance} />
          ))}
        </div>
      </div>
    </div>
  );
}
