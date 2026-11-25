import { ChevronRightIcon } from "lucide-react";

import { DrillLink } from "@/core/ui/composites/drill-link";

import { maskedTodayLine } from "../domain/today";

import {
  TODAY_REVENUE_CARD,
  TODAY_REVENUE_LINK,
  TodayRevenueLoading,
  TodayRevenueToggle,
} from "./today-revenue-parts";
import { TodayRevenueShow } from "./today-revenue-show";

/**
 * The Owner's **Today line** (v2.5 "Revenue every day", kickoff 9 R5): the last line of Today's
 * main column (recorded decision Q12(a)). "November · ₹ ••• achieved of ₹ ••• · Show", then
 * "Open Revenue" beside it.
 *
 * **The figures load on tap** (owner answer, v2.5 review): this server part is drawn from today's
 * IST date alone and reads nothing, so no amount is in Today's HTML or RSC payload (nor in a
 * prefetch, the router cache, the service worker or a screenshot). The tap is handled by client
 * code loaded **after the page** (`TodayRevenueShow`, `AfterPage`), so `/today`'s first-load JS
 * stays as it was; it reads the month's totals once (`GET /api/revenue/month-totals`, Owner only)
 * and shows them in the same box. A view control: no history entry, nothing kept.
 *
 * Today renders this only for a viewer with `finance.view` (the Owner); an Admin's Today has no
 * line, and the address refuses anyone else (invariant 2).
 */
export function TodayRevenueLine({ today }: { today: string }) {
  return (
    <section
      aria-label="Revenue this month"
      data-slot="today-revenue"
      className={TODAY_REVENUE_CARD}
    >
      <TodayRevenueShow masked={maskedTodayLine(today)} loading={<TodayRevenueLoading />}>
        <TodayRevenueToggle words={maskedTodayLine(today)} shown={false} />
      </TodayRevenueShow>
      <DrillLink
        href="/reports/revenue"
        className={TODAY_REVENUE_LINK}
        data-slot="today-revenue-open"
      >
        Open Revenue
        <ChevronRightIcon aria-hidden className="text-muted-foreground size-4" />
      </DrillLink>
    </section>
  );
}
