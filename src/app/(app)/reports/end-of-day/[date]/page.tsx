import { CalendarOffIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { checkThenRead } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { systemClock, todayIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  cutoffWords,
  eodDateHeading,
  eodDayState,
  EodReportView,
  getEodReport,
  liveNote,
  parseEodDate,
  previewEodReport,
  savedNote,
} from "@/modules/reports";
import { getSettings } from "@/modules/settings";

import { EOD_REPORT_DESCRIPTION } from "../copy";

export const metadata: Metadata = { title: "End of day" };

/**
 * One day's end-of-day report (6.5; Kickoff 6 decisions 16–17; WORKFLOWS §8a), one tap under
 * Reports → End of day (a drill-down with the §14.2 k back control; the notification's deep link
 * lands here with the list beneath). Today is computed live, so far; yesterday live until the
 * End-day cutoff ("Live until it saves at 5:00 AM"), then its saved row; any earlier day shows
 * the saved row only, never recomputed. `reports.all` (the Owner); a date that is not one is 404.
 */
export default async function EndOfDayReportPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const [, [{ date: segment }, settings]] = await checkThenRead(
    requirePermission("reports.all"),
    Promise.all([params, getSettings()]),
  );
  const date = parseEodDate(segment);
  if (!date) notFound();
  const today = todayIST();
  const state = eodDayState({
    date,
    today,
    cutoff: settings.endDayCutoffTime,
    now: systemClock(),
  });
  // The title bar stays "End of day" (its loading screen cannot know the date); the day is the
  // first line under it, so nothing in the bar changes when the page arrives.
  const header = (
    <>
      <PageHeader
        back={{ href: "/reports/end-of-day", label: "End of day" }}
        title="End of day"
        description={EOD_REPORT_DESCRIPTION}
        help={EOD_REPORT_DESCRIPTION}
      />
      <h2 data-slot="eod-date" className="mb-2 flex h-5 items-center text-sm font-semibold">
        {eodDateHeading(date, today)}
      </h2>
    </>
  );
  if (state === "future") {
    return (
      <>
        {header}
        <EmptyState
          icon={CalendarOffIcon}
          title="That day hasn't come yet"
          description="A report is built as the day goes and saved the next morning."
        />
      </>
    );
  }
  const live = state === "today" || state === "yesterday_live";
  const saved = live ? null : await getEodReport(date);
  const report = live ? await previewEodReport(date) : saved?.report;
  const note = liveNote(state, settings.endDayCutoffTime);
  return (
    <>
      {header}
      {note ? (
        <p data-slot="eod-live-note" className="text-muted-foreground mb-4 text-sm">
          {note}
        </p>
      ) : saved ? (
        // A saved day keeps the live note's line (when it was saved), so nothing moves when the
        // page arrives over its loading screen.
        <p data-slot="eod-saved-note" className="text-muted-foreground mb-4 text-sm">
          {savedNote(saved.generatedAt)}
        </p>
      ) : null}
      {report ? (
        <EodReportView report={report} />
      ) : (
        <EmptyState
          icon={CalendarOffIcon}
          title="Not saved yet"
          description={`This day's report saves at ${cutoffWords(settings.endDayCutoffTime)} the morning after, and this one hasn't been saved. Reports began with the end-of-day job.`}
        />
      )}
    </>
  );
}
