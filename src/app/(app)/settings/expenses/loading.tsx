import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SETTINGS_HEADERS } from "../headers";

/**
 * Settings → Expenses: the Categories heading, the add form (a field and Add), four category
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
          <Skeleton className="h-4 w-24" />
          <div className="border-border flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-11 w-full" />
            </div>
            <Skeleton className="h-11 w-full sm:w-20" />
          </div>
          <ul className="border-border divide-border divide-y rounded-lg border">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex min-h-11 items-center gap-3 px-4 py-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="ml-auto size-8 rounded-md" />
              </li>
            ))}
          </ul>
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
