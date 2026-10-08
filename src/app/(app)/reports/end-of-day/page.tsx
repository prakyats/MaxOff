import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { cn } from "@/core/lib/utils";
import { requirePermission } from "@/core/permissions/server";
import { systemClock, todayIST } from "@/core/time";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PageHeader } from "@/core/ui/composites/page-header";
import { ViewLink } from "@/core/ui/composites/view-link";
import { Button } from "@/core/ui/primitives/button";
import { EOD_PAGE_SIZE, eodHref, eodListEntries, listEodReports } from "@/modules/reports";
import { getSettings } from "@/modules/settings";

import { END_OF_DAY_DESCRIPTION } from "./copy";
import { EOD_LIST_CLASS, EOD_ROW_CLASS } from "./list-row";

export const metadata: Metadata = { title: "End of day" };

/**
 * Reports → End of day (6.5; Kickoff 6 decision 17; WORKFLOWS §8a): today (live, so far), yesterday
 * (live until the End-day cutoff, then its saved row), then every saved report, newest first,
 * kept forever, a page at a time (the pager is a view control: it replaces the entry). A row opens
 * that day's report, a drill-down. `reports.all` (the Owner).
 */
export default async function EndOfDayListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, [params, settings]] = await checkThenRead(
    requirePermission("reports.all"),
    Promise.all([searchParams, getSettings()]),
  );
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
  const saved = await listEodReports(page, EOD_PAGE_SIZE);
  const today = todayIST();
  const entries = eodListEntries({
    today,
    cutoff: settings.endDayCutoffTime,
    now: systemClock(),
    saved: saved.rows,
  });
  // Today and yesterday lead only the first page; a later page is the history alone.
  const shown = page === 1 ? entries : entries.filter((entry) => entry.state === "saved");
  const pages = Math.max(1, Math.ceil(saved.total / EOD_PAGE_SIZE));
  const previous = page > 1 ? pageHref(page - 1) : null;
  const next = page < pages ? pageHref(page + 1) : null;

  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="End of day"
        description={END_OF_DAY_DESCRIPTION}
        help={END_OF_DAY_DESCRIPTION}
      />
      <ul data-slot="eod-list" className={EOD_LIST_CLASS}>
        {shown.map((entry) => (
          <li key={entry.date}>
            <DrillLink
              href={eodHref(entry.date)}
              data-slot="eod-list-row"
              data-state={entry.state}
              data-date={entry.date}
              className={cn(
                EOD_ROW_CLASS,
                "active:bg-muted/60 focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{entry.heading}</span>
                <span className="text-muted-foreground text-sm">{entry.detail}</span>
              </span>
              <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </DrillLink>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <nav
          aria-label="Older reports"
          data-slot="eod-pager"
          className="mt-3 flex min-h-11 items-center justify-between gap-2 md:max-w-2xl"
        >
          <PagerLink href={previous} label="Newer reports">
            <ChevronLeftIcon aria-hidden />
          </PagerLink>
          <p className="text-sm font-medium tabular-nums" aria-live="polite">
            Page {page} of {pages}
          </p>
          <PagerLink href={next} label="Older reports">
            <ChevronRightIcon aria-hidden />
          </PagerLink>
        </nav>
      ) : null}
    </>
  );
}

function pageHref(page: number): string {
  return page === 1 ? "/reports/end-of-day" : `/reports/end-of-day?page=${page}`;
}

function PagerLink({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <Button variant="ghost" size="icon" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="ghost" size="icon" asChild>
      <ViewLink href={href} aria-label={label} icon scroll={false}>
        {children}
      </ViewLink>
    </Button>
  );
}
