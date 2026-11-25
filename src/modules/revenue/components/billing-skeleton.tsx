import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import {
  BILLING_CARD,
  BILLING_CHEVRON,
  BILLING_FIGURE,
  BILLING_FIGURES,
  BILLING_FIGURES_GRID,
  BILLING_ROW,
  BILLING_ROW_TEXT,
  BILLING_SECTION,
} from "./billing-layout";

/**
 * The Billing section traced, shown while its one read is on its way (the project page's
 * `<Suspense>` fallback, never the route's `loading.tsx`: that screen is an Admin's too, and
 * must not hint at billing). The heading, the Category and Amount rows with their control, then
 * a retainer's cycle (its label over Potential · Achieved · Remaining) or a one-time project's
 * Advances row. The section is the page's last, so whatever it lists below only grows downward.
 *
 * Two variants the page knows without any money read (9.2 review): a retainer with **no cycle in
 * view** has no figures block, and a one-time project that is past its delivery date or has
 * every deliverable finished has its "Was due" / "Ready to complete" line above Advances.
 */
export function BillingSkeleton({
  retainer,
  cycle = true,
  status = false,
  completed = false,
}: {
  retainer: boolean;
  /**
   * A retainer: whether a cycle is in view (its figures, Billed, Adjust and the planned list are
   * drawn only then). A one-time project: whether it has its one cycle (its Billed row).
   */
  cycle?: boolean;
  /** A one-time project: whether its status line ("Was due" / "Ready to complete") will show. */
  status?: boolean;
  /** A one-time project: completed, so its Adjust row shows (v2.5). */
  completed?: boolean;
}) {
  return (
    <div aria-hidden className={BILLING_SECTION} data-slot="billing-skeleton">
      <span className="flex h-5 items-center">
        <Skeleton className="h-3.5 w-12" />
      </span>
      <div className={BILLING_CARD}>
        {["w-16", "w-28"].map((label) => (
          <div key={label} className={BILLING_ROW} data-row="">
            <span className={BILLING_ROW_TEXT}>
              <span className="flex h-4 items-center">
                <Skeleton className={cn("h-3", label)} />
              </span>
              <span className="flex h-5 items-center">
                <Skeleton className="h-3.5 w-24" />
              </span>
            </span>
            <Skeleton className="h-11 w-20 shrink-0 rounded-lg md:h-8" />
          </div>
        ))}
        {!retainer && status ? (
          <div className="px-4 py-3" data-row="" data-slot="billing-skeleton-status">
            <span className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-40" />
            </span>
          </div>
        ) : null}
        {/* v2.5: a one-time project's Billed, its Adjust once completed, and the history. */}
        {!retainer && cycle ? <TwoLineRow slot="billing-skeleton-billed" /> : null}
        {!retainer && completed ? <AdjustRowSkeleton /> : null}
        {!retainer ? <SummaryRowSkeleton slot="billing-skeleton-history" /> : null}
        {retainer ? (
          cycle ? (
            <>
              <div className={BILLING_FIGURES} data-row="">
                <span className="flex h-4 items-center">
                  <Skeleton className="h-3 w-24" />
                </span>
                <div className={BILLING_FIGURES_GRID}>
                  {[0, 1, 2].map((cell) => (
                    <span key={cell} className={BILLING_FIGURE}>
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
              <TwoLineRow slot="billing-skeleton-billed" />
              <AdjustRowSkeleton />
              <SummaryRowSkeleton slot="billing-skeleton-planned" />
              <SummaryRowSkeleton slot="billing-skeleton-history" />
            </>
          ) : (
            <SummaryRowSkeleton slot="billing-skeleton-history" />
          )
        ) : (
          <div className={BILLING_ROW} data-row="">
            <span className={BILLING_ROW_TEXT}>
              <span className="flex h-5 items-center">
                <Skeleton className="h-3.5 w-20" />
              </span>
              <span className="flex h-4 items-center">
                <Skeleton className="h-3 w-36" />
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** A 64 px row: a small label over one line, its control beside them (Billed, v2.5). */
function TwoLineRow({ slot }: { slot: string }) {
  return (
    <div className={BILLING_ROW} data-row="" data-slot={slot}>
      <span className={BILLING_ROW_TEXT}>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-14" />
        </span>
        <span className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-24" />
        </span>
      </span>
      <Skeleton className="h-11 w-28 shrink-0 rounded-lg md:h-8" />
    </div>
  );
}

/** The Adjust row (v2.5): its label, the figure and the line under it, with its control. */
function AdjustRowSkeleton() {
  return (
    <div className={BILLING_ROW} data-row="" data-slot="billing-skeleton-adjust">
      <span className={BILLING_ROW_TEXT}>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-16" />
        </span>
        <span className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-20" />
        </span>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-36" />
        </span>
      </span>
      <Skeleton className="h-11 w-20 shrink-0 rounded-lg md:h-8" />
    </div>
  );
}

/** A collapsed part's row (v2.5: Planned deliverables, Billing history): name, line, chevron. */
function SummaryRowSkeleton({ slot }: { slot: string }) {
  return (
    <div className={BILLING_ROW} data-row="" data-slot={slot}>
      <span className={BILLING_ROW_TEXT}>
        <span className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-32" />
        </span>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-48 max-w-full" />
        </span>
      </span>
      <span aria-hidden className={BILLING_CHEVRON} />
    </div>
  );
}
