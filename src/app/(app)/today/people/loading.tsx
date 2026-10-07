import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { PersonRowsSkeleton } from "@/modules/attendance";

import { PEOPLE_DESCRIPTION, PeopleFilter } from "./people-filter";

/**
 * The full board as it renders (6.2), traced (ARCHITECTURE §14.1): the header with its back
 * control, the group filter (the same control, nothing chosen yet), then a group's heading and
 * its person rows, as `PeopleBoard` draws them.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        back={{ href: "/today", label: "Today" }}
        title="Everyone today"
        description={PEOPLE_DESCRIPTION}
      />
      <PeopleFilter current={null} />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading everyone today"
        data-slot="loading-today-people"
        className="mb-4 flex flex-col gap-4"
      >
        <div>
          <div className="mb-2 flex h-5 items-center">
            <Skeleton className="h-3.5 w-36" />
          </div>
          <PersonRowsSkeleton rows={4} />
        </div>
        <span className="sr-only">Loading everyone today</span>
      </div>
    </>
  );
}
