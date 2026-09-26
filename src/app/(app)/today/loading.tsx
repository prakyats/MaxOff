import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { LoadingState, PageLoading } from "@/core/ui/composites/loading-state";
import { TodayAttendanceStripSkeleton, TodayBoardSkeleton } from "@/modules/attendance";

/**
 * Owner Today / Admin dashboard (6.2, 6.3) open on a grid of stat tiles, so the skeleton is
 * tiles — not the list this route used to borrow from People. An Admin's screen starts with
 * the one-line attendance strip (2.3); the Owner's with today's attendance card and the people
 * board (2.4). The skeleton asks who is looking: the `(app)` layout already resolved the member
 * for this request (`cache()`), so this costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const strip = member !== null && can(member.role, "attendance.self");
  const board = member !== null && can(member.role, "attendance.view_all");
  return (
    <PageLoading title="Today" shape="tiles">
      {strip ? <TodayAttendanceStripSkeleton /> : null}
      {board ? <TodayBoardSkeleton /> : null}
      <LoadingState shape="tiles" label="Loading Today" />
    </PageLoading>
  );
}
