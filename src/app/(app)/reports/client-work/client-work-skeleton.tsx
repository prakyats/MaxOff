import { CARD_GRID_CLASS, ClientWorkCardSkeleton, ReportHeading } from "@/modules/reports";

/**
 * The client-work report while it loads: "Totals" over the all-clients card, then "By client" over
 * four client cards, in the page's own section and grid classes and the card's own shape.
 */
export function ClientWorkSkeleton() {
  return (
    <div
      className="flex min-w-0 flex-col gap-6"
      role="status"
      aria-busy="true"
      data-slot="loading-client-work-report"
    >
      <span className="sr-only">Loading the client-work report</span>
      <div className="flex min-w-0 flex-col gap-2">
        <ReportHeading id="loading-client-work-total">Totals</ReportHeading>
        <div className={CARD_GRID_CLASS}>
          <ClientWorkCardSkeleton />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <ReportHeading id="loading-client-work-list">By client</ReportHeading>
        <div className={CARD_GRID_CLASS}>
          {[0, 1, 2, 3].map((card) => (
            <ClientWorkCardSkeleton key={card} />
          ))}
        </div>
      </div>
    </div>
  );
}
