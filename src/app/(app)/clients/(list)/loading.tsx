import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { LoadingState, PageLoading } from "@/core/ui/composites/loading-state";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The client list (3.4) traced: the "Client items" row (7.3), the search box and the filters (two for the Owner, state and
 * Admin; one for an Admin), then cards on a phone and the table from `md` up (logo and name,
 * state, Admin). In the `(list)` group so it never wraps a client's page (the 2.9 rule).
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const filters = member !== null && can(member.role, "clients.manage") ? 2 : 1;
  return (
    <PageLoading title="Clients" shape="cards">
      {/* The "Client items" row (7.3) above the list. */}
      <Skeleton aria-hidden className="mb-3 h-11 w-full rounded-lg" />
      <div className="flex flex-col gap-3">
        <div
          data-slot="loading-toolbar"
          aria-hidden
          className="flex flex-col gap-2 md:flex-row md:items-center"
        >
          <Skeleton className="h-11 w-full rounded-lg md:h-8 md:w-72" />
          <div className="grid grid-cols-2 gap-2 md:flex">
            {Array.from({ length: filters }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full rounded-lg md:h-8 md:w-36" />
            ))}
          </div>
        </div>
        <LoadingState shape="cards" count={5} label="Loading Clients" className="md:hidden" />
        <LoadingState
          shape="table"
          columns={["w-1/3", "w-1/6", "w-1/4"]}
          label="Loading Clients"
          className="hidden md:block"
        />
      </div>
    </PageLoading>
  );
}
