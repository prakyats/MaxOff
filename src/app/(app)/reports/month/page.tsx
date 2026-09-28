import type { Metadata } from "next";

import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  addMonths,
  getMonthSummary,
  historyMonth,
  monthLabel,
  monthOf,
  monthRange,
  TeamMonthList,
} from "@/modules/attendance";
import { formatRupees, listApprovedInMonth } from "@/modules/expenses";

import { LeavePager } from "../../leave/leave-nav";

export const metadata: Metadata = { title: "Month" };

const DESCRIPTION =
  "Each person's IST month, live: days worked, additional leave (leave + ½ × half days + absent), comp leave, overtime and approved expenses not yet paid. No salary: you work out pay from these.";

/** How far back the pager goes: two years of months. */
const MONTHS_BACK = 23;

/**
 * The team's month for the Owner (PRODUCT §4.18, WORKFLOWS §2b, kickoff 3b decision 30: More →
 * Reports → Month; 3b.4): one row per Admin and Staff member, days worked of the working days,
 * additional leave, days waiting for review, and with `expenses.decide` the approved expenses
 * not yet paid. A row opens that person's month. The month switcher replaces the entry.
 */
export default async function TeamMonthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, { month: requested }] = await Promise.all([
    requirePermission("attendance.view_all"),
    searchParams,
  ]);
  const current = monthOf(todayIST());
  const { month, previous, next } = historyMonth(requested, {
    first: addMonths(current, -MONTHS_BACK),
    current,
  });
  const seesExpenses = can(viewer.role, "expenses.decide");
  const [summaries, approved] = await Promise.all([
    getMonthSummary(month),
    seesExpenses ? listApprovedInMonth(monthRange(month)) : Promise.resolve([]),
  ]);

  // Paise as integers, so a column of amounts adds up exactly.
  const unpaid = new Map<string, number>();
  for (const claim of approved) {
    unpaid.set(claim.memberId, (unpaid.get(claim.memberId) ?? 0) + Math.round(claim.amount * 100));
  }
  const extra = Object.fromEntries(
    [...unpaid].map(([memberId, paise]) => [
      memberId,
      <span key={memberId} data-slot="team-month-unpaid" className="tabular-nums">
        {formatRupees(paise / 100)} to pay
      </span>,
    ]),
  );
  const href = (m: string) => `/reports/month?month=${m}`;

  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="Month"
        description={DESCRIPTION}
        help={DESCRIPTION}
      />
      <LeavePager
        label={monthLabel(month)}
        previous={previous ? href(previous) : null}
        next={next ? href(next) : null}
        previousLabel="Previous month"
        nextLabel="Next month"
      />
      <div className="md:max-w-3xl">
        <TeamMonthList summaries={summaries} month={month} extra={extra} />
      </div>
    </>
  );
}
