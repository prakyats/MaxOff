import { ChevronRightIcon } from "lucide-react";

import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { END_OF_DAY_DESCRIPTION } from "./copy";
import { EOD_LIST_CLASS, EOD_ROW_CLASS } from "./list-row";

/**
 * Reports → End of day (6.5), traced: the header with its back, then the day rows in the page's
 * own list and row geometry (`list-row.ts`): each a line for the day over a line for live / saved,
 * and the chevron. Three rows: today, yesterday and the newest saved day.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="End of day"
        description={END_OF_DAY_DESCRIPTION}
        help={END_OF_DAY_DESCRIPTION}
      />
      <div role="status" aria-busy="true" aria-label="Loading the reports">
        <ul aria-hidden data-slot="loading-eod-list" className={EOD_LIST_CLASS}>
          {[0, 1, 2].map((row) => (
            <li key={row} className={EOD_ROW_CLASS}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex h-5 items-center">
                  <Skeleton className="h-3.5 w-40 max-w-full" />
                </span>
                <span className="flex h-5 items-center">
                  <Skeleton className="h-3 w-28 max-w-full" />
                </span>
              </span>
              <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </li>
          ))}
        </ul>
        <span className="sr-only">Loading the reports</span>
      </div>
    </>
  );
}
