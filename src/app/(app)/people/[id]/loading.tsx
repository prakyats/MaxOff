import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";

import { PersonProfileSkeleton } from "./person-profile-skeleton";

/**
 * A person's Profile while it loads, under the layout's header and tabs (`PersonProfileSkeleton`,
 * also what a tap draws before the router answers, v7.0). The `(app)` layout already read the
 * member for this request (`cache()`), so asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  return (
    <PersonProfileSkeleton
      canEdit={member !== null && can(member.role, "team.manage")}
      owner={member !== null && can(member.role, "attendance.view_all")}
    />
  );
}
