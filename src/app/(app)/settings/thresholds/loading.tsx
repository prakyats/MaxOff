import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { SETTINGS_HEADERS } from "../headers";

/** The four groups' summary widths: the page's lines, near enough, at a phone's width. */
const GROUPS = ["w-24", "w-16", "w-24", "w-28"];

/**
 * Traces `page.tsx` (ARCHITECTURE §14.1), the Thresholds groups (6b.6): the one-line intro, then
 * the four closed groups, each a bordered row with the name over its summary line beside the
 * chevron, then Save (the phone's bar; the form's last row on a laptop).
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Thresholds"
        {...SETTINGS_HEADERS.thresholds}
        back={{ href: "/settings", label: "Settings" }}
      />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Thresholds"
        data-slot="loading-thresholds"
        className="flex flex-col gap-4"
      >
        <span aria-hidden className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-72 max-w-full" />
        </span>
        {GROUPS.map((width, index) => (
          <div
            key={index}
            aria-hidden
            className="border-border bg-card rounded-card flex min-h-16 items-center gap-3 border px-4 py-2.5"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex h-5 items-center">
                <Skeleton className={`h-3.5 ${width}`} />
              </span>
              <span className="flex h-5 items-center">
                <Skeleton className="h-3.5 w-full max-w-md" />
              </span>
              {/* A summary wraps to a second line at a phone's width. */}
              <span className="flex h-5 items-center md:hidden">
                <Skeleton className="h-3.5 w-2/3" />
              </span>
            </span>
            <Skeleton className="size-4 shrink-0" />
          </div>
        ))}
        <div aria-hidden className="flex justify-end">
          <Skeleton className="rounded-control h-11 w-full md:h-8 md:w-36" />
        </div>
        <span className="sr-only">Loading Thresholds</span>
      </div>
    </>
  );
}
