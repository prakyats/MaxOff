import { LoadingState } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { GUIDE_HEADER } from "./header";

/**
 * Traces the guide: the role line, the 44px search box and its count line, then sections of
 * topic rows (a title over a one-line summary and a chevron: the `cards` row geometry the real
 * rows share through `row-metrics`).
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title={GUIDE_HEADER.title}
        description={GUIDE_HEADER.description}
        help={GUIDE_HEADER.description}
        back={GUIDE_HEADER.back}
      />
      <div className="-mt-2 mb-4 flex h-5 items-center">
        <Skeleton className="h-3.5 w-36" />
      </div>
      <div className="flex max-w-2xl flex-col gap-6" data-slot="guide-loading">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-11 w-full rounded-md" />
          <div className="flex min-h-5 items-center">
            <Skeleton className="h-3.5 w-40" />
          </div>
        </div>
        {[4, 3, 4].map((rows, index) => (
          <div key={index} className="flex flex-col gap-2">
            <div className="flex h-5 items-center px-1">
              <Skeleton className="h-3.5 w-28" />
            </div>
            <LoadingState shape="cards" count={rows} label="Loading the guide" />
          </div>
        ))}
      </div>
    </>
  );
}
