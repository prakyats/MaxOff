import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { LoadingState, PageLoading } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";

/**
 * Reports: the Owner's list of reports (3b.4: Month first, rows like Settings), traced as a list;
 * an Admin's placeholder leads with the six KPI tiles their reports will have (9.x), so it traces
 * tiles. The `(app)` layout already read the member for this request (`cache()`).
 */
export default async function Loading() {
  const member = await getCurrentMember();
  if (member !== null && can(member.role, "attendance.view_all")) {
    return (
      <>
        <PageHeader title="Reports" />
        <LoadingState shape="list" count={1} label="Loading reports" className="md:max-w-2xl" />
      </>
    );
  }
  return <PageLoading title="Reports" shape="tiles" />;
}
