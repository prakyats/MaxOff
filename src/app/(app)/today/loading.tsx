import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageHeader } from "@/core/ui/composites/page-header";
import { TodayAttendanceStripSkeleton, TodayBoardSkeleton } from "@/modules/attendance";

import { StandInSkeleton } from "../_placeholder/stand-in-skeleton";
import { dayStandIn, standInDescription } from "../_placeholder/stand-ins";

/**
 * Today, as it renders now (3c review, owner decision: a stand-in route's skeleton traces the
 * stand-in, not the future screen). The Owner's, whose home this is: today's attendance card and
 * the people board (2.4), then the stand-in below them (`todayOwner`). An Admin's starts with the
 * one-line attendance strip (2.3) and their own stand-in; a Staff member who types the URL gets
 * the strip and the My Day copy (`dayStandIn`, as the page picks it). The skeleton asks who is
 * looking: the `(app)` layout already resolved the member for this request (`cache()`), so this
 * costs no query. When 6.2 / 6.3 build the real screen, this goes back to the grid of stat tiles
 * the owner specified (`loading-routes.test.ts`).
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const strip = member !== null && can(member.role, "attendance.self");
  const board = member !== null && can(member.role, "attendance.view_all");
  const copy = dayStandIn(member?.role ?? "owner");
  return (
    <>
      <PageHeader title="Today" description={standInDescription(copy, member?.name)} />
      {strip ? <TodayAttendanceStripSkeleton /> : null}
      {board ? <TodayBoardSkeleton /> : null}
      <StandInSkeleton copy={copy} label="Loading Today" />
    </>
  );
}
