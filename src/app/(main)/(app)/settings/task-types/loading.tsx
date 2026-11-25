import { ListHeadingSkeleton, ListRowsSkeleton } from "@/core/ui/composites/list-rows-skeleton";
import { PageLoading } from "@/core/ui/composites/loading-state";

import { SETTINGS_HEADERS } from "../headers";

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1): the list's heading with "Add task type" (C4), then one
 * bordered list of the seven launch types, each a 56px row with the name over its kind line on the
 * left and its actions on the right (the ⋯ on a phone; Move up, Move down, Edit and Archive from
 * `md` up).
 */
export default function Loading() {
  return (
    <PageLoading
      title="Task types"
      {...SETTINGS_HEADERS.taskTypes}
      shape="list"
      back={{ href: "/settings", label: "Settings" }}
    >
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Task types"
        data-slot="loading-task-types"
        className="flex max-w-2xl flex-col gap-3"
      >
        <ListHeadingSkeleton titleWidth="w-24" addWidth="w-36" />
        <ListRowsSkeleton rows={7} icons={4} subtitle />
        <span className="sr-only">Loading Task types</span>
      </div>
    </PageLoading>
  );
}
