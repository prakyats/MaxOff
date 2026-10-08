import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { ApprovalGroupSkeleton } from "@/core/ui/composites/approval-group-skeleton";
import { PageHeader } from "@/core/ui/composites/page-header";

const DESCRIPTION = "Everything waiting for your decision, oldest first.";

/**
 * One Approvals screen, grouped, no tabs (2.4), traced row for row by `ApprovalGroupSkeleton`
 * (a heading, rows with two actions): the Owner's Attendance, Leave, Extra work (3b.2), Expenses
 * (3b.3) and Staff tasks (4.5) groups; an Admin's one group, the tasks they check (4.5). The
 * `(app)` layout already resolved the member for this request (`cache()`), so asking costs no
 * query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const decides = member !== null && can(member.role, "attendance.decide");
  return (
    <>
      <PageHeader title="Approvals" description={DESCRIPTION} help={DESCRIPTION} />
      <div className="flex flex-col gap-6" data-slot="loading-approvals">
        {decides ? (
          <>
            <ApprovalGroupSkeleton rows={3} />
            <ApprovalGroupSkeleton rows={2} />
            <ApprovalGroupSkeleton rows={1} />
            <ApprovalGroupSkeleton rows={1} />
            <ApprovalGroupSkeleton rows={2} />
          </>
        ) : (
          <ApprovalGroupSkeleton rows={3} />
        )}
        <span className="sr-only">Loading approvals</span>
      </div>
    </>
  );
}
