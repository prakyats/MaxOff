import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";

import { MeSkeleton } from "./me-skeleton";

/**
 * Me while it loads (`MeSkeleton`, also what a tap draws before the router answers, v7.0). The
 * `(app)` layout already read the member for this request (`cache()`), so asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  return (
    <MeSkeleton
      ownPages={member !== null && can(member.role, "attendance.self")}
      owner={member?.role === "owner"}
    />
  );
}
