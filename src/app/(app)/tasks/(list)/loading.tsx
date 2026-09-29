import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { StandInSkeleton } from "../../_placeholder/stand-in-skeleton";
import { STAND_INS } from "../../_placeholder/stand-ins";

/**
 * Tasks, as it renders now (3c review: the skeleton traces the stand-in, worded as the page
 * words it: the work you give out, or the work given to you), with the "New task" action for the
 * Owner and Admins (4.3). When 4.5 builds the task list, this goes back to the card list the owner
 * specified (`loading-routes.test.ts`); it must never be the avatar list this route once
 * borrowed from People. In the `(list)` group so it never wraps a task's page (the 2.9 rule).
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const team = member !== null && can(member.role, "tasks.create");
  return (
    <>
      {/* The Owner's and an Admin's "New task" (4.3): the FAB on a phone, the header's button above. */}
      <PageHeader
        title="Tasks"
        actions={
          team ? <Skeleton aria-hidden data-slot="loading-fab" className="w-32" /> : undefined
        }
      />
      <StandInSkeleton
        copy={team ? STAND_INS.tasksTeam : STAND_INS.tasksMine}
        label="Loading Tasks"
      />
    </>
  );
}
