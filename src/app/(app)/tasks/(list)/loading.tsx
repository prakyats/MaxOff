import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { TaskRowsSkeleton, TaskSectionHeadingSkeleton } from "@/modules/tasks";

/**
 * The Tasks tab as it renders (4.5), traced per role (ARCHITECTURE §14.1). The Owner and Admins:
 * the header with "New task" (the FAB on a phone), "Needs you" with two rows that carry their
 * reason line, the open tasks, then the two links deeper. Staff, "My tasks" with "Suggest a task"
 * (the FAB on a phone, 4.6): two groups of rows and the links. Every row is a `TaskRow`'s height and lines (`TaskRowsSkeleton`). In the `(list)`
 * group so it never wraps a task's page (the 2.9 rule). The `(app)` layout already read the member
 * for this request (`cache()`), so asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const team = member !== null && can(member.role, "tasks.create");
  return (
    <>
      {team ? (
        <PageHeader
          title="Tasks"
          description="What needs you, then every open task by deadline."
          actions={<Skeleton aria-hidden data-slot="loading-fab" className="w-32" />}
        />
      ) : (
        <PageHeader
          title="My tasks"
          description="The work given to you, and what's due next."
          actions={<Skeleton aria-hidden data-slot="loading-fab" className="w-40" />}
        />
      )}
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading tasks"
        data-slot="loading-tasks"
        className="flex max-w-3xl min-w-0 flex-col gap-6"
      >
        {team ? (
          <>
            <section className="flex min-w-0 flex-col gap-2">
              <TaskSectionHeadingSkeleton />
              <TaskRowsSkeleton rows={2} notes={2} label="Needs you" />
            </section>
            <section className="flex min-w-0 flex-col gap-2">
              <TaskSectionHeadingSkeleton />
              <TaskRowsSkeleton rows={4} label="Open tasks" />
            </section>
          </>
        ) : (
          <>
            <section className="flex min-w-0 flex-col gap-2">
              <TaskSectionHeadingSkeleton />
              <TaskRowsSkeleton rows={2} label="Not noted" />
            </section>
            <section className="flex min-w-0 flex-col gap-2">
              <TaskSectionHeadingSkeleton />
              <TaskRowsSkeleton rows={3} label="Upcoming" />
            </section>
          </>
        )}
        <div aria-hidden className="flex flex-col gap-2">
          {[0, 1].map((link) => (
            <div
              key={link}
              className="border-border bg-card flex min-h-12 min-w-0 items-center justify-between gap-3 rounded-lg border px-4 py-2.5"
            >
              <Skeleton className="h-4 w-36 max-w-full" />
              <Skeleton className="size-4 shrink-0" />
            </div>
          ))}
        </div>
        <span className="sr-only">Loading tasks</span>
      </div>
    </>
  );
}
