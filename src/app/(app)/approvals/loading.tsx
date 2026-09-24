import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { ApprovalGroupSkeleton } from "@/core/ui/composites/approval-group";
import { LoadingState } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";

/**
 * One Approvals screen, grouped, no tabs (2.4): the Owner's Attendance and Leave groups, traced
 * row for row by `ApprovalGroupSkeleton`. An Admin decides neither and still gets the
 * placeholder until 4.5; the `(app)` layout already resolved the member for this request
 * (`cache()`), so asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const decides = member !== null && can(member.role, "attendance.decide");
  return (
    <>
      <PageHeader title="Approvals" />
      {decides ? (
        <div className="flex flex-col gap-6">
          <ApprovalGroupSkeleton rows={3} />
          <ApprovalGroupSkeleton rows={2} />
          <span className="sr-only">Loading approvals</span>
        </div>
      ) : (
        <LoadingState shape="list" count={2} actions={2} label="Loading approvals" />
      )}
    </>
  );
}
