import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { LoadingState, PageLoading } from "@/core/ui/composites/loading-state";
import { TodayAttendanceCardSkeleton } from "@/modules/attendance";

/**
 * Owner Today / Admin dashboard (6.2, 6.3) open on a grid of stat tiles, so the skeleton is
 * tiles — not the list this route used to borrow from People. An Admin's screen starts with
 * today's attendance card (2.2) and the Owner's does not, so the skeleton asks who is looking:
 * the `(app)` layout already resolved the member for this request (`cache()`), so this costs
 * no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const card = member !== null && can(member.role, "attendance.self");
  return (
    <PageLoading title="Today" shape="tiles">
      {card ? <TodayAttendanceCardSkeleton /> : null}
      <LoadingState shape="tiles" label="Loading Today" />
    </PageLoading>
  );
}
