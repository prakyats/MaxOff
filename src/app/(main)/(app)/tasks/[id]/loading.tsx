import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { TaskPageSkeleton } from "@/modules/tasks/components/task-page-skeleton";

/** A task's page traced: `TaskPageSkeleton` (also what a tap draws before the router answers). */
export default async function Loading() {
  const member = await getCurrentMember();
  return <TaskPageSkeleton manages={member !== null && can(member.role, "tasks.create")} />;
}
