import { PageHeader } from "@/core/ui/composites/page-header";

import { StandInSkeleton } from "../_placeholder/stand-in-skeleton";
import { STAND_INS } from "../_placeholder/stand-ins";

/**
 * The calendar, as it renders now (3c review: the skeleton traces the stand-in, the same for
 * every role). When 6.4 builds the calendar, this goes back to its own shape: a week strip of
 * days above a column of blocks (`loading-day-strip`), which is neither a list nor tiles.
 */
export default function Loading() {
  return (
    <>
      <PageHeader title="Calendar" />
      <StandInSkeleton copy={STAND_INS.calendar} label="Loading Calendar" />
    </>
  );
}
