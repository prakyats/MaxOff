import type { Metadata } from "next";

import { addISTDays, todayIST, toISTDate } from "@/core/time";
import { historyMonth, listDays, monthLabel, monthOf } from "@/modules/attendance";
import { AttendanceHistory } from "@/modules/attendance/components/attendance-history";

import { LeavePager } from "../../../leave/leave-nav";
import { loadPerson } from "../person";

export const metadata: Metadata = { title: "Attendance & leave" };

/**
 * One person's attendance, one IST month at a time, for the Owner (task 2.4): the member's own
 * history in the Owner's words, with Correct on every day (WORKFLOWS §1: any state, a reason the
 * member reads). The month switcher replaces the entry (ARCHITECTURE §14.2 d).
 */
export default async function PersonAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { month: requested }] = await Promise.all([params, searchParams]);
  const person = await loadPerson(id);
  const today = todayIST();
  // Attendance starts the IST day after joining (WORKFLOWS §1, 2.2).
  const firstDay = person.joinedAt ? addISTDays(toISTDate(person.joinedAt), 1) : today;
  const { month, previous, next } = historyMonth(requested, {
    first: monthOf(firstDay),
    current: monthOf(today),
  });
  const days = await listDays(person.id, month);
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
        viewpoint={{ kind: "owner", name: person.fullName }}
      />
    </>
  );
}
