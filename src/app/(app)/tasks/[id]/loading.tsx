import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { DetailHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import {
  TaskDetailsSkeleton,
  TaskViewsSkeleton,
} from "@/modules/tasks/components/task-page-skeleton";

import { TASK_BACK } from "./task";

/**
 * A task's page traced (4.4, reworked to Kickoff 4 decisions 26–32; decision 31): the title bar
 * (with the ⋯ an Owner or Admin usually has, the state chip, and for Staff the next step in the
 * header's action area from `md` up), the first glance (the state chip and priority, the deadline
 * line, the "needed from you" callout), for Staff the next step's sticky bar at a phone's foot (a
 * Staff member nearly always has one), the views' bar and **the view the
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
        <DetailHeader
          back={TASK_BACK}
          // The state chip beside the title, and for Staff the next step in the header's action
          // area (PP-task-1, PP-crew-8; laptop only, as on the page).
          status={<Skeleton aria-hidden className="h-5 w-20 rounded-full" />}
          primary={manages ? undefined : <Skeleton aria-hidden className="h-9 w-32 rounded-lg" />}
          title={
            // The title's own line box: 24px on a phone, 32px from `md` up (`PageHeader`'s h1).
            <span className="flex h-6 items-center md:h-8">
              <Skeleton className="h-5 w-48 max-w-full" />
            </span>
          }
          // History (every viewer), then the ⋯ an Owner or Admin usually has.
          menu={
            <>
              <Skeleton aria-hidden className="size-11 rounded-lg" />
              {manages ? <Skeleton aria-hidden className="size-11 rounded-lg md:size-8" /> : null}
            </>
          }
          className="mb-0 flex-wrap md:mb-0"
        />
        {/* The first glance (PP-task-1, PP-task-2): the state chip (a phone's; the header's on
            a laptop) and the quiet priority, the deadline's own line, the callout of what is
            needed now. */}
        <div aria-hidden data-slot="loading-task-glance" className="flex min-w-0 flex-col gap-2">
          {/* A phone's full title under the one-line bar (its 28px line). */}
          <div className="flex h-7 min-w-0 items-center md:hidden">
            <Skeleton className="h-5 w-56 max-w-full" />
          </div>
          {/* 20px with the phone's chip; 16px on a laptop, where only the 12px priority shows. */}
          <div className="flex h-5 min-w-0 flex-wrap items-center gap-2 md:h-4">
            <Skeleton className="h-5 w-20 rounded-full md:hidden" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex h-5 min-w-0 items-center gap-1.5">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className="h-4 w-44 max-w-full" />
          </div>
          <div className="border-border bg-muted/50 flex min-w-0 items-center rounded-lg border px-3 py-2.5">
            <div className="flex h-5 min-w-0 items-center">
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </div>
        </div>
        {manages ? null : (
          <div
            aria-hidden
            data-slot="loading-task-step"
            className="border-border bg-card/95 fixed inset-x-0 bottom-[calc(var(--app-bottom-nav-h)+var(--app-safe-bottom)+var(--app-bands-h,0px))] z-30 flex border-t py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:hidden"
          >
            <Skeleton className="h-11 flex-1 rounded-lg" />
          </div>
        )}
        <TaskViewsSkeleton />
      </div>
      <TaskDetailsSkeleton />
      <span className="sr-only">Loading the task</span>
    </div>
  );
}
