import type { Metadata } from "next";

import { displayName } from "@/core/lib/display-name";

import { addISTDays, todayIST, toISTDate } from "@/core/time";
import { historyMonth, listDays, monthLabel, monthOf } from "@/modules/attendance";
import { AttendanceHistory } from "@/modules/attendance/components/attendance-history";
import { getCompBalance } from "@/modules/leave";

import { LeavePager } from "../../../leave/leave-nav";
import { loadHistoryPerson } from "../person";

/**
 * The tab names the person, then this view ("Prishit Shetty · Attendance & leave · MaxOff"), from
 * `loadHistoryPerson` (`loadPerson` and the session's member row).
 * Next resolves metadata on a prefetch too; the layout's header makes the same `cache()`d
 * `loadPerson` on it, so the title adds no read to a prefetch (P2 item 6).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const person = await loadHistoryPerson((await params).id);
  return { title: `${displayName(person.fullName)} · Attendance & leave` };
}

/**
 * One person's attendance, one IST month at a time, for the Owner (task 2.4): the member's own
 * history in the Owner's words; every row opens its day, whose sheet holds Correct (WORKFLOWS §1:
 * any state, a reason the member reads) and, on a waiting day, Approve (V5b-D). The month
 * switcher replaces the entry (ARCHITECTURE §14.2 d).
 */
export default async function PersonAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { month: requested }] = await Promise.all([params, searchParams]);
  const person = await loadHistoryPerson(id);
  const today = todayIST();
  // Attendance starts the IST day after joining (WORKFLOWS §1, 2.2).
  const firstDay = person.joinedAt ? addISTDays(toISTDate(person.joinedAt), 1) : today;
  const { month, previous, next } = historyMonth(requested, {
    first: monthOf(firstDay),
    current: monthOf(today),
  });
  // The Correct dialog greys out comp leave when the person has no credit to draw (3c review):
  // the app composes the two modules here, attendance never reads leave itself.
  const [days, balance] = await Promise.all([
    listDays(person.id, month),
    getCompBalance(person.id),
  ]);
  const href = (m: string) => `/people/${person.id}/attendance?month=${m}`;

  return (
    <>
      <LeavePager
        label={monthLabel(month)}
        previous={previous ? href(previous) : null}
        next={next ? href(next) : null}
        previousLabel="Previous month"
        nextLabel="Next month"
      />
      <AttendanceHistory
        days={days}
        monthName={monthLabel(month)}
        today={today}
        viewpoint={{ kind: "owner", name: person.fullName, compDays: balance.availableDays }}
      />
    </>
  );
}
