import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { ApprovalGroupSkeleton } from "@/core/ui/composites/approval-group";
import { PageHeader } from "@/core/ui/composites/page-header";

import { StandInSkeleton } from "../_placeholder/stand-in-skeleton";
import { STAND_INS } from "../_placeholder/stand-ins";

/**
 * One Approvals screen, grouped, no tabs (2.4): the Owner's Attendance, Leave, Extra work (3b.2)
 * and Expenses (3b.3) groups, traced row for row by `ApprovalGroupSkeleton`. An Admin decides
 * none of these and sees the stand-in until 4.5, so their skeleton traces the stand-in (3c
 * review); 4.5 puts back the grouped list with two actions per row the owner specified. The
 * `(app)` layout already resolved the member for this request (`cache()`), so asking costs no
 * query.
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
          <ApprovalGroupSkeleton rows={1} />
          <ApprovalGroupSkeleton rows={1} />
          <span className="sr-only">Loading approvals</span>
        </div>
      ) : (
        <StandInSkeleton copy={STAND_INS.approvalsAdmin} label="Loading approvals" />
      )}
    </>
  );
}
