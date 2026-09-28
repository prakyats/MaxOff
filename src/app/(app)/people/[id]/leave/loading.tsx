import { LoadingState } from "@/core/ui/composites/loading-state";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * A person's comp leave card (3b.2: title, balance line, the grant button) and their requests
 * (2.4) under the layout's header and tabs (which stay painted): cards on a phone and the table
 * from `md` up, as on the member's own /leave.
 */
export default function Loading() {
  return (
    <>
      <div
        data-slot="loading-comp-leave-card"
        aria-hidden
        className="border-border bg-card mb-4 flex items-center justify-between gap-3 rounded-xl border px-6 py-6"
      >
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3.5 w-52" />
        </div>
        <Skeleton className="h-8 w-36 rounded-md" />
      </div>
      <LoadingState shape="cards" count={5} label="Loading their leave" className="md:hidden" />
      <LoadingState
        shape="table"
        columns={["w-1/4", "w-1/4", "w-1/6", "w-1/6"]}
        label="Loading their leave"
        className="hidden md:block"
      />
    </>
  );
}
