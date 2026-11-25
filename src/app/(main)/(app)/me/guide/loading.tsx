import { ChevronDownIcon } from "lucide-react";

import { getCurrentMember } from "@/core/auth/server";
import { cn } from "@/core/lib/utils";
import { PageHeader } from "@/core/ui/composites/page-header";
import { CARD_ROW_MIN_H, CARD_ROW_PADDING } from "@/core/ui/composites/row-metrics";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { guideFor } from "@/modules/guide";

import { GUIDE_HEADER } from "./header";

/** Enough sections to fill the first screen; the rest of the guide is below it. */
const SECTIONS_DRAWN = 3;

/** Words drawn unseen, each line a bar: they wrap exactly as the page's own words do. */
const UNSEEN =
  "bg-muted rounded-md box-decoration-clone text-transparent select-none motion-safe:animate-pulse";

/**
 * Traces the guide: the role line, the 44px search box and its count line, then the reader's own
 * guide's first three sections, read for the role as `me/loading.tsx` reads it (content only: no
 * member data). Each section's heading and each closed topic row (the `cards` row geometry the
 * real rows share through `row-metrics`: a title over a one-line summary, and a chevron) is drawn
 * with its own words, unseen, so a title that wraps on a phone wraps here too and nothing below
 * it moves when the page arrives.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const sections = guideFor(member?.role ?? "staff").sections.slice(0, SECTIONS_DRAWN);
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
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading the guide"
        className="flex max-w-2xl flex-col gap-6"
        data-slot="guide-loading"
      >
        <div className="flex flex-col gap-2">
          <Skeleton className="h-11 w-full rounded-md" />
          <div className="flex min-h-5 items-center">
            <Skeleton className="h-3.5 w-40" />
          </div>
        </div>
        {sections.map((section) => (
          <div key={section.id} aria-hidden className="flex flex-col gap-2">
            <p className="px-1 text-sm font-medium">
              <span className={UNSEEN}>{section.title}</span>
            </p>
            <ul className="border-border divide-border bg-card shadow-raised divide-y rounded-lg border">
              {section.topics.map((topic) => (
                // The row inside the item, as the page's button is: the divider is the item's,
                // outside the row's 64px.
                <li key={topic.id} data-slot="loading-row">
                  <div className={cn("flex items-center gap-3", CARD_ROW_MIN_H, CARD_ROW_PADDING)}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium break-words">
                        <span className={UNSEEN}>{topic.title}</span>
                      </span>
                      {/* The summary is one line (`truncate`): a bar in its 16px line box. */}
                      <span className="flex h-4 items-center">
                        <Skeleton className="h-3 w-2/3" />
                      </span>
                    </span>
                    <ChevronDownIcon
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <span className="sr-only">Loading the guide</span>
      </div>
    </>
  );
}
