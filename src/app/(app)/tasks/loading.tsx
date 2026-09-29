import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageHeader } from "@/core/ui/composites/page-header";

import { StandInSkeleton } from "../_placeholder/stand-in-skeleton";
import { STAND_INS } from "../_placeholder/stand-ins";

/**
 * Tasks, as it renders now (3c review: the skeleton traces the stand-in, worded as the page
 * words it: the work you give out, or the work given to you). When 4.5 builds the task list, this
 * goes back to the card list the owner specified (`loading-routes.test.ts`); it must never be the
 * avatar list this route once borrowed from People.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const team = member !== null && can(member.role, "tasks.create");
  return (
    <>
      <PageHeader title="Tasks" />
      <StandInSkeleton
        copy={team ? STAND_INS.tasksTeam : STAND_INS.tasksMine}
        label="Loading Tasks"
      />
    </>
  );
}
