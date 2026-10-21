import { ListHeadingSkeleton, ListRowsSkeleton } from "@/core/ui/composites/list-rows-skeleton";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SETTINGS_HEADERS } from "../headers";

/**
 * Settings → Expenses: the Categories heading with "Add expense category" (C4), four category
 * rows, then the Receipts heading and its one amount field, as the page draws them.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Expenses"
        {...SETTINGS_HEADERS.expenses}
      />
      <div
        aria-hidden
        className="flex max-w-2xl flex-col gap-8"
        data-slot="loading-expenses-settings"
      >
        <div className="flex flex-col gap-3">
          <ListHeadingSkeleton titleWidth="w-20" addWidth="w-36" />
          <ListRowsSkeleton rows={4} icons={4} />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3.5 w-56" />
          <Skeleton className="h-11 w-40" />
        </div>
      </div>
      <span className="sr-only">Loading the expense settings</span>
    </>
  );
}
