import { Skeleton } from "@/core/ui/primitives/skeleton";

import {
  REVENUE_CARD,
  REVENUE_CLIENT_HEAD,
  REVENUE_FIGURE,
  REVENUE_FIGURES,
  REVENUE_FILTER,
  REVENUE_FILTER_CELL,
  REVENUE_LINE,
  REVENUE_LINE_FIGURE,
  REVENUE_LINE_TEXT,
  REVENUE_PAGE,
  REVENUE_PAGER,
  REVENUE_SECTION,
} from "./revenue-layout";

/**
 * The Revenue page traced (ARCHITECTURE §14.1), in the page's own boxes: the month row with its
 * two arrows, the category filter's four cells, the month's three figures, then "By client" and
 * one client's card with two lines. It holds no word and no figure: the route's loading screen
 * is drawn before the role is known to the page, and must hint at no money.
 */
export function RevenueSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading revenue"
      className={REVENUE_PAGE}
      data-slot="loading-revenue"
    >
      <div aria-hidden className={REVENUE_PAGER} data-slot="loading-revenue-month">
        <Skeleton className="size-11 rounded-md md:size-8" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-11 rounded-md md:size-8" />
      </div>
      <div aria-hidden className={REVENUE_FILTER} data-slot="loading-revenue-filter">
        {["w-8", "w-14", "w-12", "w-24"].map((width) => (
          <span key={width} className={REVENUE_FILTER_CELL}>
            <Skeleton className={`h-3.5 ${width}`} />
          </span>
        ))}
      </div>
      <div aria-hidden className={REVENUE_CARD} data-slot="loading-revenue-summary">
        <div className={REVENUE_FIGURES}>
          {[0, 1, 2].map((cell) => (
            <span key={cell} className={REVENUE_FIGURE}>
              <span className="flex h-4 items-center">
                <Skeleton className="h-3 w-14" />
              </span>
              <span className="flex h-5 items-center">
                <Skeleton className="h-3.5 w-16" />
              </span>
            </span>
          ))}
        </div>
      </div>
      <div aria-hidden className={REVENUE_SECTION}>
        <span className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-16" />
        </span>
        <div className={REVENUE_CARD} data-slot="loading-revenue-client">
          <div className={REVENUE_CLIENT_HEAD}>
            <span className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-32" />
            </span>
            <span className="flex h-4 items-center">
              <Skeleton className="h-3 w-3/4" />
            </span>
          </div>
          {[0, 1].map((row) => (
            <div key={row} className={REVENUE_LINE} data-row="">
              <span className={REVENUE_LINE_TEXT}>
                <span className="flex h-5 items-center">
                  <Skeleton className="h-3.5 w-2/5" />
                </span>
                <span className="flex h-4 items-center">
                  <Skeleton className="h-3 w-3/5" />
                </span>
                {/* v2.5: the line's "Billed 3 Dec" / "Not billed". */}
                <span className="flex h-4 items-center">
                  <Skeleton className="h-3 w-16" />
                </span>
              </span>
              <span className={REVENUE_LINE_FIGURE}>
                <span className="flex h-5 items-center">
                  <Skeleton className="h-3.5 w-16" />
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading revenue</span>
    </div>
  );
}
