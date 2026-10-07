import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getTodayPeople, PeopleBoard, summariseToday } from "@/modules/attendance";
import { boardForGroup, parsePeopleGroup } from "@/modules/dashboards";

import { PEOPLE_DESCRIPTION, PeopleFilter } from "./people-filter";

export const metadata: Metadata = { title: "Everyone today" };

/**
 * The full people board (2.4), one tap deeper than the Owner's Today (6.2, ROADMAP: "the full
 * board moves to its own drill-down behind See all N people"): everyone expected today, each once,
 * in the order the Owner acts on them, filtered by group (a count on Today opens it on that
 * group). A drill-down with the §14.2 k back control; tapping a person opens their history.
 * `attendance.view_all` (the Owner).
 */
export default async function TodayPeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, [today, params]] = await checkThenRead(
    requirePermission("attendance.view_all"),
    Promise.all([getTodayPeople(), searchParams]),
  );
  const group = parsePeopleGroup(params.group);
  const summary = summariseToday(today.people, today.isDayOff);
  const shown = { ...summary, board: boardForGroup(summary.board, group) };
  return (
    <>
      <PageHeader
        back={{ href: "/today", label: "Today" }}
        title="Everyone today"
        description={PEOPLE_DESCRIPTION}
      />
      <PeopleFilter current={group} />
      <PeopleBoard summary={shown} />
    </>
  );
}
