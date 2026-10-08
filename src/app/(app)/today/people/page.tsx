import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  getTodayPeople,
  getUnendedYesterday,
  PeopleBoard,
  summariseToday,
} from "@/modules/attendance";
import { boardForGroup, parsePeopleGroup } from "@/modules/dashboards";

import { PEOPLE_DESCRIPTION, PeopleFilter } from "./people-filter";
import { showsYesterday, YESTERDAY_LINE_CLASS, yesterdayLine } from "./yesterday";

export const metadata: Metadata = { title: "Everyone today" };

/**
 * The full people board (2.4), one tap deeper than the Owner's Today (6.2, ROADMAP: "the full
 * board moves to its own drill-down behind See all N people"): everyone expected today, each once,
 * in the order the Owner acts on them, filtered by group (a count on Today opens it on that
 * group). A drill-down with the §14.2 k back control; tapping a person opens their history.
 * `attendance.view_all` (the Owner).
 *
 * "End not recorded" (kickoff 6 decision 24, amended by the owner 2026-10-08) is about
 * **yesterday**: the people whose End day was not recorded yesterday and whose day the Owner has
 * not decided, each with yesterday's state, from the End-day cutoff on, as the card counts them.
 */
export default async function TodayPeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, [today, unended, params]] = await checkThenRead(
    requirePermission("attendance.view_all"),
    Promise.all([getTodayPeople(), getUnendedYesterday(), searchParams]),
  );
  const group = parsePeopleGroup(params.group);
  const summary = summariseToday(today.people, today.isDayOff, unended);
  const yesterday = showsYesterday(params.group);
  const board = yesterday
    ? boardForGroup(summariseToday(unended, false).board, group)
    : boardForGroup(summary.board, group);
  const shown = { ...summary, board };
  return (
    <>
      <PageHeader
        back={{ href: "/today", label: "Today" }}
        title="Everyone today"
        description={PEOPLE_DESCRIPTION}
      />
      <PeopleFilter current={group} />
      {yesterday ? (
        <p data-slot="people-yesterday" className={YESTERDAY_LINE_CLASS}>
          {yesterdayLine(todayIST())}
        </p>
      ) : null}
      <PeopleBoard
        summary={shown}
        empty={yesterday ? "Every day yesterday was ended or decided." : undefined}
      />
    </>
  );
}
