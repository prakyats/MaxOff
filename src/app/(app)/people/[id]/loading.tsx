import { LoadingState } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { PersonTabsSkeleton } from "./person-nav";

/**
 * A person's requests (2.4): their name in the title bar, the two tabs, then cards on a phone
 * and the table from `md` up, as on the member's own /leave.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title={<Skeleton className="h-5 w-40" />}
        back={{ href: "/people", label: "People" }}
      />
      <PersonTabsSkeleton />
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
