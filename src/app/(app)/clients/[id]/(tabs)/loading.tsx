import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";

import { SERVER_PARTS } from "../../../skeleton-parts";
import { ClientOverviewSkeleton } from "../client-overview-skeleton";

/**
 * A client's Overview while it loads, under the layout's header and tabs (`ClientOverviewSkeleton`,
 * also what a tap draws before the router answers, v7.0). The `(app)` layout already read the
 * member for this request (`cache()`), so asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  return (
    <ClientOverviewSkeleton
      parts={SERVER_PARTS}
      ownerNotes={member !== null && can(member.role, "clients.private_notes")}
      projects={member !== null && can(member.role, "projects.manage")}
    />
  );
}
