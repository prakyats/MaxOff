import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  MonthCloseScreen,
  parseCloseMonth,
  readMonthClose,
  revenueMonthHref,
} from "@/modules/revenue";

import { CLOSE_DESCRIPTION } from "./copy";

export const metadata: Metadata = { title: "Month close" };

/**
 * The Owner's close screen (v3.5 U4; PRODUCT §4.13, WORKFLOWS §7): `/reports/close/YYYY-MM`,
 * reached from the Revenue page's month header (a drill-down: back returns to Revenue). What is
 * still waiting, Close, or for a closed month its versions, "Changed since close" and Correct.
 *
 * **Owner only, and the read waits for the check** (ARCHITECTURE §19; invariant 2): an Admin or a
 * Crew member who types the address is sent to the not-allowed page before anything about the
 * month is read, so nothing tells them whether a month is closed (PERMISSIONS "Month close"). The
 * page reads `month_close_read` once (`readMonthClose`, `cache()`d; the metadata is static, so
 * nothing else asks).
 */
export default async function MonthClosePage({ params }: { params: Promise<{ month: string }> }) {
  const [, { month: slug }] = await Promise.all([requirePermission("finance.view"), params]);
  const month = parseCloseMonth(slug);
  if (!month) notFound();
  const read = readMonthClose(month);
  return (
    <>
      <PageHeader
        back={{ href: revenueMonthHref(month), label: "Revenue" }}
        title="Month close"
        description={CLOSE_DESCRIPTION}
        help={CLOSE_DESCRIPTION}
      />
      <MonthCloseScreen read={read} month={month} />
    </>
  );
}
