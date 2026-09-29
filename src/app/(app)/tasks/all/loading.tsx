import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { LoadingState } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The full task list (4.5) traced: the header with its back control, the search box and the
 * filters (six for the Owner and Admins: state, deadline, person, client, type, engagement; three
 * for Staff), then cards on a phone and the table from `md` up (task, state, deadline, primary
 * owner, client, type).
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const team = member !== null && can(member.role, "tasks.create");
  const title = team ? "All tasks" : "All my tasks";
  return (
    <>
      <PageHeader
        back={{ href: "/tasks", label: "Tasks" }}
        title={title}
        description="Every open task, and the latest 300 finished ones."
      />
      <div className="flex flex-col gap-3" data-slot="loading-all-tasks">
        <div
          data-slot="loading-toolbar"
          aria-hidden
          className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center"
        >
          <Skeleton className="h-11 w-full rounded-lg md:h-8 md:w-72" />
          <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
            {Array.from({ length: team ? 6 : 3 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full rounded-lg md:h-8 md:w-36" />
            ))}
          </div>
        </div>
        <LoadingState shape="cards" count={6} label={`Loading ${title}`} className="md:hidden" />
        <LoadingState
          shape="table"
          columns={["w-1/4", "w-1/6", "w-1/6", "w-1/6", "w-1/8", "w-1/8"]}
          label={`Loading ${title}`}
          className="hidden md:block"
        />
      </div>
    </>
  );
}
