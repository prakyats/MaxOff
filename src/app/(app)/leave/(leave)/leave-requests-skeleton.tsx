import { LoadingState } from "@/core/ui/composites/loading-state";

import type { SkeletonParts } from "../../skeleton-parts";

/**
 * The balance strip (PP-crew-1, V5b: two tiles of three lines), then the requests list under the
 * layout's header and tabs (which stay painted): cards on a phone, the table from `md` up. No
 * pager row: it only appears past 20 requests. One component for the route's `loading.tsx` and
 * its tap drawing (v7.0).
 */
export function LeaveRequestsSkeleton({
  parts,
}: {
  parts: Pick<SkeletonParts, "LeaveBalanceStripSkeleton">;
}) {
  const { LeaveBalanceStripSkeleton } = parts;
  return (
    <>
      <LeaveBalanceStripSkeleton />
      <LoadingState shape="cards" count={5} label="Loading your leave" className="md:hidden" />
      <LoadingState
        shape="table"
        columns={["w-1/4", "w-1/4", "w-1/6", "w-1/6"]}
        label="Loading your leave"
        className="hidden md:block"
      />
    </>
  );
}
