import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";

import { cn } from "@/core/lib/utils";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";

import { parsePeriod } from "@/modules/reports";
import { todayIST } from "@/core/time";
import { getMonthSummary, monthLabel, monthOf, monthRange } from "@/modules/attendance";
import { formatRupees, listApprovedInMonth } from "@/modules/expenses";

import { AdminReport } from "./admin-report";
import { REPORTS_DESCRIPTION } from "./copy";
import { monthStrip } from "./month-strip";
import { MonthStripView } from "./month-strip-view";
import {
  OWNER_REPORTS,
  REPORT_LINES_CLASS,
  REPORT_ROW_CLASS,
  REPORTS_LIST_CLASS,
} from "./list-row";

export const metadata: Metadata = { title: "Reports" };

/**
 * Owner reports (task 9.3) and the Admin's scoped operational reports share this route. Since
 * 3b.4 the Owner's first real report is here: **Month** (the team's month summary,
 * `attendance.view_all`), a row that drills into it, in the shape of the Settings list. Since 6.3
 * an Admin reads their **work report** (`reports.scoped`, `AdminReport`).
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, params] = await Promise.all([
    requirePermission(["reports.all", "reports.scoped"]),
    searchParams,
  ]);
  if (!can(viewer.role, "attendance.view_all")) {
    return <AdminReport viewer={viewer} period={parsePeriod(params, todayIST())} />;
  }
  // Major change 7 (PP-reports-1): this month at a glance, from the Month report's own reads
  // (month_summary(), and with expenses.decide the approved claims not yet paid; never money
  // anywhere else, invariant 2).
  const month = monthOf(todayIST());
  const seesExpenses = can(viewer.role, "expenses.decide");
  const [summaries, approved] = await Promise.all([
    getMonthSummary(month),
    seesExpenses ? listApprovedInMonth(monthRange(month)) : Promise.resolve(null),
  ]);
  // Paise as integers, so the total adds up exactly (as the Month report).
  const paise = (approved ?? []).reduce((sum, claim) => sum + Math.round(claim.amount * 100), 0);
  const strip = monthStrip(
    summaries,
    approved === null ? null : { paise, count: approved.length, words: formatRupees(paise / 100) },
  );
  return (
    <>
      <PageHeader title="Reports" description={REPORTS_DESCRIPTION} help={REPORTS_DESCRIPTION} />
      <MonthStripView strip={strip} month={monthLabel(month)} />
      <ul data-slot="reports-list" className={REPORTS_LIST_CLASS}>
        {OWNER_REPORTS.map((report) => (
          <li key={report.key}>
            <DrillLink
              href={report.href}
              data-slot="report-link"
              className={cn(
                REPORT_ROW_CLASS,
                "active:bg-muted/60 focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset",
              )}
            >
              <span className={REPORT_LINES_CLASS}>
                <span className="text-sm font-medium">{report.label}</span>
                <span className="text-muted-foreground text-sm">{report.description}</span>
              </span>
              <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </DrillLink>
          </li>
        ))}
      </ul>
    </>
  );
}
