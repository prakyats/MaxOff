import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * Suggested tasks as they render (4.6), traced (ARCHITECTURE §14.1): the header (with "Suggest a
 * task" for whoever suggests, the FAB on a phone), then "Waiting": two suggestions, each a title
 * over its byline, a line of details and the row of buttons, in one bordered list. The `(app)`
 * layout already read the member (`cache()`), so asking costs no query.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const suggests = member !== null && can(member.role, "task_requests.create");
  return (
    <>
      <PageHeader
        title="Suggested tasks"
        back={{ href: "/tasks", label: "Tasks" }}
        actions={
          suggests ? <Skeleton aria-hidden data-slot="loading-fab" className="w-40" /> : undefined
        }
      />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading suggested tasks"
        data-slot="loading-task-requests"
        className="flex max-w-3xl min-w-0 flex-col gap-2"
      >
        <Skeleton aria-hidden className="h-4 w-24" />
        <ul aria-hidden className="border-border divide-border bg-card divide-y rounded-lg border">
          {[0, 1].map((row) => (
            <li key={row} className="flex min-w-0 flex-col gap-2 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-3 w-40 max-w-full" />
              </div>
              <Skeleton className="h-4 w-64 max-w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-11 w-32 rounded-lg md:h-9" />
                <Skeleton className="h-11 w-24 rounded-lg md:h-9" />
              </div>
            </li>
          ))}
        </ul>
        <span className="sr-only">Loading suggested tasks</span>
      </div>
    </>
  );
}
