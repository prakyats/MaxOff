import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import type { SkeletonParts } from "../../skeleton-parts";
import { PERSON_BACK } from "./back";

/**
 * A person's header and tabs while they stream in (the layout's fallback): back · the name's bar
 * · the status chip, History and ⋯ for whoever manages the team, and for the Owner the person's
 * today line and the tab bar's shape (four 44 px cells, as `PersonTabs` draws them), since the
 * Owner nearly always gets one. Also the tap drawing's header (v7.0).
 */
export function PersonHeaderSkeleton({
  parts,
  manages,
  owner,
}: {
  parts: Pick<SkeletonParts, "PersonTodayLineSkeleton">;
  manages: boolean;
  owner: boolean;
}) {
  const { PersonTodayLineSkeleton } = parts;
  return (
    <>
      <PageHeader
        title={<Skeleton className="h-5 w-40" />}
        back={PERSON_BACK}
        status={<Skeleton className="h-5 w-16 rounded-full" />}
        menu={
          manages ? (
            <>
              <Skeleton aria-hidden className="size-11 rounded-lg" />
              <Skeleton aria-hidden className="size-11 rounded-lg" />
            </>
          ) : undefined
        }
      />
      {owner ? (
        <>
          <PersonTodayLineSkeleton />
          <div
            aria-hidden
            data-slot="loading-person-tabs"
            className="bg-muted mb-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,4.5rem),1fr))] gap-1 rounded-lg p-1 md:inline-grid md:w-[32rem]"
          >
            {[0, 1, 2, 3].map((cell) => (
              <div key={cell} className="flex min-h-11 items-center justify-center">
                <Skeleton className="h-3.5 w-14" />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
