import { ListHeadingSkeleton, ListRowsSkeleton } from "@/core/ui/composites/list-rows-skeleton";
import { PageLoading } from "@/core/ui/composites/loading-state";

import { SETTINGS_HEADERS } from "../headers";

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1): the list's heading with "Add job title" (C4), then the
 * bordered list of 56px rows, each a name beside its actions (the ⋯ on a phone; Move up, Move
 * down, Rename and Archive from `md` up).
 */
export default function Loading() {
  return (
    <PageLoading
      title="Job titles"
      {...SETTINGS_HEADERS.jobTitles}
      shape="list"
      back={{ href: "/settings", label: "Settings" }}
    >
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Job titles"
        data-slot="loading-job-titles"
        className="flex max-w-2xl flex-col gap-3"
      >
        <ListHeadingSkeleton titleWidth="w-24" addWidth="w-32" />
        <ListRowsSkeleton rows={5} icons={4} />
        <span className="sr-only">Loading Job titles</span>
      </div>
    </PageLoading>
  );
}
