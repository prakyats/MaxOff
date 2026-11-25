import { StickyActions } from "@/core/ui/composites/sticky-actions";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import {
  CLOSE_CARD,
  CLOSE_HEADING,
  CLOSE_MONTH,
  CLOSE_PAGE,
  CLOSE_ROW,
  CLOSE_ROW_END,
  CLOSE_ROW_TEXT,
  CLOSE_SECTION,
} from "./month-close-layout";

/**
 * The close screen traced (ARCHITECTURE §14.1), in the screen's own boxes: the month's line, a
 * section heading over a card of three two-line rows with a count at their end, and the one
 * action's bar. It holds no word: the loading screen is drawn before the page has checked who is
 * asking, and must hint at no month's state (an Admin never learns that a month is closed).
 */
export function MonthCloseSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the month"
      className={CLOSE_PAGE}
      data-slot="loading-month-close"
    >
      <div aria-hidden className={CLOSE_MONTH} data-slot="loading-month-close-month">
        <span className="flex h-6 items-center">
          <Skeleton className="h-4 w-36" />
        </span>
      </div>
      <div aria-hidden className={CLOSE_SECTION} data-slot="loading-month-close-section">
        <span className={CLOSE_HEADING}>
          <Skeleton className="h-3.5 w-24" />
        </span>
        <div className={CLOSE_CARD}>
          {["w-24", "w-20", "w-28"].map((width) => (
            <div key={width} className={CLOSE_ROW} data-row="">
              <span className={CLOSE_ROW_TEXT}>
                <span className="flex h-5 items-center">
                  <Skeleton className={`h-3.5 ${width}`} />
                </span>
                <span className="flex h-4 items-center">
                  <Skeleton className="h-3 w-3/5" />
                </span>
              </span>
              <span className={CLOSE_ROW_END}>
                <span className="flex h-5 items-center">
                  <Skeleton className="h-3.5 w-6" />
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <StickyActions>
        <Skeleton aria-hidden className="h-11 w-full rounded-lg md:h-8 md:w-60" />
      </StickyActions>
      <span className="sr-only">Loading the month</span>
    </div>
  );
}
