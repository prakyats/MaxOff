import { LoadingState } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * One Approvals screen, grouped, no tabs (2.4 / 4.5): a heading per group, then rows that each
 * carry approve and reject. The skeleton traces the grouping too, so the headings do not appear
 * out of nowhere when the data lands.
 */
export default function Loading() {
  return (
    <>
      <PageHeader title="Approvals" />
      <div className="flex flex-col gap-6">
        {["attendance", "leave"].map((group) => (
          <section key={group} className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-28" />
            <LoadingState shape="list" count={2} actions={2} label={`Loading ${group} approvals`} />
          </section>
        ))}
      </div>
    </>
  );
}
