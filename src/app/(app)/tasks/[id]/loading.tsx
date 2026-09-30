import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import {
  TaskDetailsSkeleton,
  TaskViewsSkeleton,
} from "@/modules/tasks/components/task-page-skeleton";

/**
 * A task's page traced (4.4, reworked to Kickoff 4 decisions 26–32; decision 31): the title bar
 * (with the ⋯ an Owner or Admin usually has), the first glance (the state · priority · deadline
 * line and the "needed from you" line), for Staff the next step (a sticky bar at a phone's foot, a
 * row from `md` up: a Staff member nearly always has one), the views' bar and **the view the
 * address asks for** (`TaskViewsSkeleton`), and Details (the desktop's right panel, a phone's view).
 * The same two columns as the page from `md` up; on a phone the parts sit straight in the page.
 * Every column is `min-w-0`, so a rem-wide bar never widens a phone at 200% text (3c review).
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const manages = member !== null && can(member.role, "tasks.create");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the task"
      data-slot="loading-task"
      className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:gap-8"
    >
      <div className="max-md:contents md:flex md:min-w-0 md:flex-1 md:flex-col md:gap-4">
        <PageHeader
          className="mb-0 md:mb-0"
          back={{ href: "/tasks", label: "Tasks" }}
          title={<Skeleton className="h-5 w-48" />}
          menu={
            manages ? <Skeleton aria-hidden className="size-11 rounded-lg md:size-8" /> : undefined
          }
        />
        <div aria-hidden data-slot="loading-task-glance" className="flex min-w-0 flex-col gap-2">
          <div className="flex h-5 min-w-0 flex-wrap items-center gap-2">
            <Skeleton className="size-2 shrink-0 rounded-full" />
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-36" />
          </div>
          <div className="flex h-5 min-w-0 items-center">
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
        </div>
        {manages ? null : (
          <>
            <div aria-hidden className="hidden md:flex">
              <Skeleton className="h-11 w-36 rounded-lg" />
            </div>
            <div
              aria-hidden
              data-slot="loading-task-step"
              className="border-border bg-card/95 fixed inset-x-0 bottom-[calc(var(--app-bottom-nav-h)+var(--app-safe-bottom)+var(--app-offline-h,0px))] z-30 flex border-t py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:hidden"
            >
              <Skeleton className="h-11 flex-1 rounded-lg" />
            </div>
          </>
        )}
        <TaskViewsSkeleton />
      </div>
      <TaskDetailsSkeleton />
      <span className="sr-only">Loading the task</span>
    </div>
  );
}
