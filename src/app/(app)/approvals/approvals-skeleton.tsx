import { ApprovalGroupSkeleton } from "@/core/ui/composites/approval-group-skeleton";
import { PageHeader } from "@/core/ui/composites/page-header";

export const APPROVALS_DESCRIPTION = "Everything waiting for your decision, oldest first.";

/**
 * One Approvals screen, grouped, no tabs (2.4), traced row for row by `ApprovalGroupSkeleton`
 * (a heading, rows with two actions): the Owner's Attendance, Leave, Extra work (3b.2), Expenses
 * (3b.3) and Staff tasks (4.5) groups; an Admin's one, the tasks they check (4.5). No client
 * items: since amendment D3 (owner 2026-10-09) an item marked done is approved in the same step,
 * so the page draws no group for them. One component for the route's
 * `loading.tsx` and its tap drawing (v7.0).
 */
export function ApprovalsSkeleton({ decides }: { decides: boolean }) {
  return (
    <>
      <PageHeader
        title="Approvals"
        description={APPROVALS_DESCRIPTION}
        help={APPROVALS_DESCRIPTION}
      />
      <div className="flex flex-col gap-6" data-slot="loading-approvals">
        {decides ? (
          <>
            {/* Every group leads each row with the person's photo (V5b-D): the tasks' rows
                with whoever handed it in (#89). */}
            <ApprovalGroupSkeleton rows={3} avatars />
            <ApprovalGroupSkeleton rows={2} avatars />
            <ApprovalGroupSkeleton rows={1} avatars />
            <ApprovalGroupSkeleton rows={1} avatars />
            <ApprovalGroupSkeleton rows={2} avatars />
          </>
        ) : (
          <ApprovalGroupSkeleton rows={3} avatars />
        )}
        <span className="sr-only">Loading approvals</span>
      </div>
    </>
  );
}
