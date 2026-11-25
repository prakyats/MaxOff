import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";

import { ApprovalsSkeleton } from "./approvals-skeleton";

/**
 * Approvals while it loads (`ApprovalsSkeleton`, also what a tap draws before the router answers,
 * v7.0). The `(app)` layout already resolved the member for this request (`cache()`), so asking
 * costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  return <ApprovalsSkeleton decides={member !== null && can(member.role, "attendance.decide")} />;
}
