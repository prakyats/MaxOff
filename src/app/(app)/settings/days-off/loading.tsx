import { ListHeadingSkeleton, ListRowsSkeleton } from "@/core/ui/composites/list-rows-skeleton";
import { PageLoading } from "@/core/ui/composites/loading-state";
import { Card, CardContent, CardHeader } from "@/core/ui/primitives/card";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SETTINGS_HEADERS } from "../headers";

/** One line of the card header's text (a bar in a line box of the same height). */
function Line({ height, width }: { height: string; width: string }) {
  return (
    <span className={`flex items-center ${height}`}>
      <Skeleton className={`h-3.5 ${width}`} />
    </span>
  );
}

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1): the Weekly off card (title, its "Currently …" line, the
 * seven 44px day tiles (P2) and Save days off), then the Holidays card (title, its line, the list's
 * heading with "Add holiday" (C4) and one year's rows).
 */
export default function Loading() {
  return (
    <PageLoading
      title="Days off & holidays"
      {...SETTINGS_HEADERS.daysOff}
      shape="list"
      back={{ href: "/settings", label: "Settings" }}
    >
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Days off & holidays"
        data-slot="loading-days-off"
        className="flex max-w-3xl flex-col gap-6"
      >
        <Card aria-hidden>
          <CardHeader>
            <Line height="h-[1.375rem]" width="w-24" />
            <Line height="h-5" width="w-48" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {["w-24", "w-24", "w-28", "w-24", "w-20", "w-24", "w-20"].map((width, day) => (
                <Skeleton key={day} className={`rounded-control h-11 ${width}`} />
              ))}
            </div>
            <Skeleton className="rounded-control h-11 w-full md:h-8 md:w-32" />
          </CardContent>
        </Card>
        <Card aria-hidden>
          <CardHeader>
            <Line height="h-[1.375rem]" width="w-20" />
            <Line height="h-5" width="w-72 max-w-full" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ListHeadingSkeleton titleWidth="w-20" addWidth="w-32" />
            <ListRowsSkeleton rows={3} icons={1} subtitle />
          </CardContent>
        </Card>
        <span className="sr-only">Loading Days off &amp; holidays</span>
      </div>
    </PageLoading>
  );
}
