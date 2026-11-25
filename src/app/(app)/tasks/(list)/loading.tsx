import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";

import { SERVER_PARTS } from "../../skeleton-parts";
import { TasksListSkeleton } from "./tasks-list-skeleton";

/**
 * The Tasks tab while it loads, per role (`TasksListSkeleton`, also what a tap draws before the
 * router answers, v7.0). The `(app)` layout already read the member for this request
 * (`cache()`), so asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  return (
    <TasksListSkeleton
      parts={SERVER_PARTS}
      team={member !== null && can(member.role, "tasks.create")}
    />
  );
}
