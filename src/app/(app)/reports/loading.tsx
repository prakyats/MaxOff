import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { LoadingState } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";

import { StandInSkeleton } from "../_placeholder/stand-in-skeleton";
import { STAND_INS } from "../_placeholder/stand-ins";

/**
 * Reports: the Owner's list of reports (3b.4: Month first, rows like Settings), traced as a list;
 * an Admin sees the stand-in until their reports arrive, so their skeleton traces the stand-in (3c
 * review); 6.5 / 9.x put back the six KPI tiles the owner specified. The `(app)` layout already
 * read the member for this request (`cache()`).
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const owner = member !== null && can(member.role, "attendance.view_all");
  return (
    <>
      <PageHeader title="Reports" />
      {owner ? (
        <LoadingState shape="list" count={1} label="Loading reports" className="md:max-w-2xl" />
      ) : (
        <StandInSkeleton copy={STAND_INS.reportsAdmin} label="Loading Reports" />
      )}
    </>
  );
}
