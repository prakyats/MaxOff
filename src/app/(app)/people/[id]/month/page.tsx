import { CalendarRangeIcon } from "lucide-react";
import type { Metadata } from "next";

import { can } from "@/core/permissions";
import { addISTDays, todayIST, toISTDate } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import {
  getMonthSummary,
  historyMonth,
  monthLabel,
  monthOf,
  monthRange,
  MonthSummaryCard,
} from "@/modules/attendance";
import { listMemberMonthClaims } from "@/modules/expenses";
import { MemberMonthClaims } from "@/modules/expenses/components/member-month-claims";

import { LeavePager } from "../../../leave/leave-nav";
import { loadHistoryPerson, loadPerson } from "../person";

export const metadata: Metadata = { title: "Month" };

/**
 * One person's month for the Owner (PRODUCT §4.18, WORKFLOWS §2b, 3b.4): the live summary of an
 * IST month (days worked, additional leave, comp leave, overtime and credits), then, for
 * `expenses.decide`, the month's expense claims with the approved-and-unpaid total and Mark
 * paid. One month at a time from the person's first; the switcher replaces the entry
 * (ARCHITECTURE §14.2 d). Admins never reach it (`attendance.view_all`, 404 otherwise).
 */
export default async function PersonMonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { month: requested }] = await Promise.all([params, searchParams]);
  const person = await loadHistoryPerson(id);
  const { viewer } = await loadPerson(id);
  const today = todayIST();
  const firstDay = person.joinedAt ? addISTDays(toISTDate(person.joinedAt), 1) : today;
  const { month, previous, next } = historyMonth(requested, {
    first: monthOf(firstDay),
    current: monthOf(today),
  });
  const seesExpenses = can(viewer.role, "expenses.decide");
  const [summaries, claims] = await Promise.all([
    getMonthSummary(month, person.id),
    seesExpenses ? listMemberMonthClaims(person.id, monthRange(month)) : Promise.resolve(null),
  ]);
  const summary = summaries[0] ?? null;
  const href = (m: string) => `/people/${person.id}/month?month=${m}`;

  return (
    <>
      <LeavePager
        label={monthLabel(month)}
        previous={previous ? href(previous) : null}
        next={next ? href(next) : null}
        previousLabel="Previous month"
        nextLabel="Next month"
      />
      <div className="flex max-w-2xl flex-col gap-6">
        {summary ? (
          <MonthSummaryCard summary={summary} />
        ) : (
          <EmptyState
            icon={CalendarRangeIcon}
            title="No month to show"
            description={`${person.fullName} was not on the team in ${monthLabel(month)}.`}
          />
        )}
        {claims ? (
          <MemberMonthClaims claims={claims} today={today} personName={person.fullName} />
        ) : null}
      </div>
    </>
  );
}
