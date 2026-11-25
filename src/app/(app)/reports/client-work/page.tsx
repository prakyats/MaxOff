import type { Metadata } from "next";
import { Suspense } from "react";

import { startEarly } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  CARD_GRID_CLASS,
  ClientWorkCard,
  type ClientWorkFacts,
  clientTotals,
  listClientWork,
  OWNER_CUSTOM_MAX_DAYS,
  parsePeriod,
  ReportHeading,
} from "@/modules/reports";

import { CLIENT_WORK_DESCRIPTION } from "../copy";
import { CustomRange } from "../custom-range";
import { PeriodControls } from "../period-controls";
import { ClientWorkSkeleton } from "./client-work-skeleton";

export const metadata: Metadata = { title: "Client work" };

const BASE = "/reports/client-work";

/**
 * The Owner's client-work report (v3.0, 9.3; PRODUCT §4.13 "client work completion · project
 * progress"): every client's deliverables for the period, the totals first. Counts only, one read
 * (`report_client_work()`), streamed behind its skeleton.
 *
 * **The money seam (v2.1, invariant 2):** each client card takes a `revenue` node. When v2.1's
 * money tables are on `main`, this page fills it, for `finance.view` only, from `modules/revenue`
 * in its own `<Suspense>` (never in this page's first wave, never in an Admin's payload, and never
 * through `modules/reports`, which holds no money). Until then the slot stays empty.
 */
export default async function ClientWorkReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requirePermission("reports.all"), searchParams]);
  const today = todayIST();
  const period = parsePeriod(params, today, OWNER_CUSTOM_MAX_DAYS);
  const facts = listClientWork(period.from, period.to);
  startEarly(facts);
  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="Client work"
        description={CLIENT_WORK_DESCRIPTION}
        help={CLIENT_WORK_DESCRIPTION}
      />
      <PeriodControls period={period} today={today} base={BASE} />
      {period.kind === "custom" ? (
        <div className="mb-4">
          <CustomRange from={period.from} to={period.to} today={today} base={BASE} />
        </div>
      ) : null}
      <Suspense fallback={<ClientWorkSkeleton />}>
        <ClientWorkSection facts={facts} />
      </Suspense>
    </>
  );
}

async function ClientWorkSection({ facts }: { facts: Promise<ClientWorkFacts[]> }) {
  const rows = await facts;
  return (
    <div className="flex min-w-0 flex-col gap-6" data-slot="client-work-report">
      <section aria-labelledby="client-work-total-title" className="flex min-w-0 flex-col gap-2">
        <ReportHeading id="client-work-total-title">Totals</ReportHeading>
        <div className={CARD_GRID_CLASS}>
          <ClientWorkCard row={clientTotals(rows)} />
        </div>
      </section>
      <section aria-labelledby="client-work-list-title" className="flex min-w-0 flex-col gap-2">
        <ReportHeading id="client-work-list-title">By client</ReportHeading>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-slot="client-work-empty">
            No client had deliverables in this period.
          </p>
        ) : (
          <div className={CARD_GRID_CLASS}>
            {rows.map((row) => (
              <ClientWorkCard key={row.clientId} row={row} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
