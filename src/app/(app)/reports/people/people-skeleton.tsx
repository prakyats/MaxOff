import { CARD_GRID_CLASS, type Period, PersonCardSkeleton } from "@/modules/reports";

import { ATTENDANCE_LINE_COUNT } from "./attendance-lines";

/** The people's cards while they load: the employees' block, four cards of the right shape. */
export function PeopleSkeleton({ period }: { period: Pick<Period, "kind"> | null }) {
  const attendance = period?.kind === "month" ? ATTENDANCE_LINE_COUNT : 0;
  return (
    <div className="flex min-w-0 flex-col gap-2" role="status" aria-busy="true">
      <span className="sr-only">Loading the people report</span>
      <div className={CARD_GRID_CLASS}>
        {[0, 1, 2, 3].map((card) => (
          <PersonCardSkeleton key={card} attendance={attendance} />
        ))}
      </div>
    </div>
  );
}
