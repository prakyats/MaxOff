import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { LoadingState, PageLoading } from "@/core/ui/composites/loading-state";
import { TodayAttendanceStripSkeleton } from "@/modules/attendance";

/**
 * Staff "My day": the one-line attendance strip (2.3) on top for whoever marks attendance, then the
 * card list of today's tasks (4.6). Same member check as `today/loading.tsx`.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const strip = member !== null && can(member.role, "attendance.self");
  return (
    <PageLoading title="My day" shape="cards">
      {strip ? <TodayAttendanceStripSkeleton /> : null}
      <LoadingState shape="cards" label="Loading My day" />
    </PageLoading>
  );
}
