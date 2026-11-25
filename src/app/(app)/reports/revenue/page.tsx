import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  parseCategory,
  parseMonth,
  readMonthSnapshots,
  readRevenueMonth,
  RevenueReport,
} from "@/modules/revenue";

import { REVENUE_DESCRIPTION } from "./copy";

export const metadata: Metadata = { title: "Revenue" };

/**
 * The Owner's Revenue page (9.2, v2.1 "Money in"; More → Reports → Revenue): one IST month's
 * Potential · Achieved · Remaining, the advances received, what needs a look, and each client's
 * lines. `?month=YYYY-MM` (this IST month by default) and `?category=` are view controls: they
 * replace the entry, so one back returns to Reports.
 *
 * **Owner only, and the money read waits for the check** (ARCHITECTURE §19; invariant 2): the
 * role is not in the JWT, so the read is started only once `finance.view` is known, never beside
 * the session read. An Admin who types the address is sent to the not-allowed page and no money
 * read is ever sent for them (the function would refuse it as well).
 *
 * **An ended month's header links to its close screen** (v3.5 U4, Q11): "Close month", or "Closed
 * 3 Oct · v1". **A closed month shows its latest version's figures** (v3.5 U5, Q12). Both come from
 * one light read beside the month's (the versions' numbers and dates and the latest version's
 * revenue section, never `month_close_read`'s live rebuild), started only for a month before this
 * IST month, so a closed month costs the same reads as an open ended one.
 */
export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requirePermission("finance.view"), searchParams]);
  const month = parseMonth(params.month);
  const read = readRevenueMonth(month);
  const today = todayIST();
  const thisMonth = `${today.slice(0, 7)}-01`;
  const snapshots = month && month < thisMonth ? readMonthSnapshots(month) : null;
  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="Revenue"
        description={REVENUE_DESCRIPTION}
        help={REVENUE_DESCRIPTION}
      />
      <RevenueReport
        read={read}
        category={parseCategory(params.category)}
        snapshots={snapshots}
        today={today}
      />
    </>
  );
}
