import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { startEarly } from "@/core/lib/start-early";
import { cn } from "@/core/lib/utils";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";

import { parsePeriod } from "@/modules/reports";
import { todayIST } from "@/core/time";
import { getMonthSummary, monthLabel, monthOf, monthRange } from "@/modules/attendance";
import { formatRupees, listApprovedInMonth } from "@/modules/expenses";
import type { MonthSummary } from "@/modules/attendance";

import { AdminReport } from "./admin-report";
import { REPORTS_DESCRIPTION } from "./copy";
import { monthStrip } from "./month-strip";
import { MonthStripSkeleton, MonthStripView } from "./month-strip-view";
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
  // anywhere else, invariant 2). Started here and streamed into the strip (v1.8 speed fix 1): the
  // header and the list don't wait for them. They start after the permission check, not with the
  // session read (`startEarly`): the role picks this branch and is not in the JWT, so an early
  // start would add two reads (one of them money) to every Admin's request (ARCHITECTURE §19).
  const month = monthOf(todayIST());
  const summaries = getMonthSummary(month);
  const approved = can(viewer.role, "expenses.decide")
    ? listApprovedInMonth(monthRange(month))
    : Promise.resolve(null);
  startEarly(summaries, approved);
  return (
    <>
      <PageHeader title="Reports" description={REPORTS_DESCRIPTION} help={REPORTS_DESCRIPTION} />
      <Suspense fallback={<MonthStripSkeleton />}>
        <MonthStripSection summaries={summaries} approved={approved} month={monthLabel(month)} />
      </Suspense>
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

/**
 * The strip, streamed: it awaits the page's reads inside the page's `<Suspense>`, whose fallback
 * is the strip's own skeleton (the one `loading.tsx` draws), so nothing moves when it arrives.
 * `approved` is null unless the viewer decides expenses (the Owner): no money otherwise.
 */
async function MonthStripSection({
  summaries,
  approved,
  month,
}: {
  summaries: Promise<MonthSummary[]>;
  approved: Promise<{ memberId: string; amount: number }[] | null>;
  month: string;
}) {
  const [people, claims] = await Promise.all([summaries, approved]);
  // Paise as integers, so the total adds up exactly (as the Month report).
  const paise = (claims ?? []).reduce((sum, claim) => sum + Math.round(claim.amount * 100), 0);
  const strip = monthStrip(
    people,
    claims === null ? null : { paise, count: claims.length, words: formatRupees(paise / 100) },
  );
  return <MonthStripView strip={strip} month={month} />;
}
