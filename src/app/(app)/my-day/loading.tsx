import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { LoadingState, PageLoading } from "@/core/ui/composites/loading-state";
import { TodayAttendanceCardSkeleton } from "@/modules/attendance";

/**
 * Staff "My day": today's attendance card (2.2) on top for whoever marks attendance, then the
 * card list of today's tasks (4.6). Same member check as `today/loading.tsx`.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const card = member !== null && can(member.role, "attendance.self");
  return (
    <PageLoading title="My day" shape="cards">
      {card ? <TodayAttendanceCardSkeleton /> : null}
      <LoadingState shape="cards" label="Loading My day" />
    </PageLoading>
  );
}
