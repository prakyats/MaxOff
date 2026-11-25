import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";

import { SERVER_PARTS } from "../../../skeleton-parts";
import { PersonMonthSkeleton } from "./month-skeleton";

/**
 * Their month while it loads (`PersonMonthSkeleton`, also in the tap drawing, v7.0). The `(app)`
 * layout already read the member for this request (`cache()`), so asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  return (
    <PersonMonthSkeleton
      parts={SERVER_PARTS}
      seesExpenses={member !== null && can(member.role, "expenses.decide")}
    />
  );
}
