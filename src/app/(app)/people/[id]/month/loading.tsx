import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { MonthSummarySkeleton } from "@/modules/attendance";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * A person's month (3b.4) under the layout's header and tabs: the month switcher row, the
 * summary's eight lines, and for the Owner the Expenses heading, its total line and two claim
 * rows, as the page draws them.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const seesExpenses = member !== null && can(member.role, "expenses.decide");
  return (
    <>
      <div
        data-slot="loading-leave-pager"
        aria-hidden
        className="mb-3 flex min-h-11 items-center justify-between gap-2"
      >
        <Skeleton className="size-11 rounded-md md:size-8" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-11 rounded-md md:size-8" />
      </div>
      <div className="flex max-w-2xl flex-col gap-6">
        <MonthSummarySkeleton />
        {seesExpenses ? (
          <div aria-hidden className="flex flex-col gap-3">
            <div className="flex min-h-11 flex-col justify-center gap-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3.5 w-52" />
            </div>
            <div className="border-border bg-card divide-border divide-y rounded-lg border">
              {[0, 1].map((i) => (
                <div key={i} className="flex min-h-16 items-start gap-3 px-4 py-3">
                  <span className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-3.5 w-3/5" />
                  </span>
                  <span className="flex flex-col items-end gap-1.5">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-3.5 w-28" />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <span className="sr-only">Loading their month</span>
    </>
  );
}
