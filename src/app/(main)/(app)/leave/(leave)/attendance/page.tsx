import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { withSessionUserId } from "@/core/auth/server";
import { requirePermission } from "@/core/permissions/server";
import { addISTDays, todayIST, toISTDate } from "@/core/time";
import { getNoteDays, historyMonth, listDays, monthLabel, monthOf } from "@/modules/attendance";
import { AttendanceHistory } from "@/modules/attendance/components/attendance-history";
import { getOwnMember } from "@/modules/team";

import { LeavePager } from "../../leave-nav";

export const metadata: Metadata = { title: "Attendance & leave" };

/**
 * The member's own attendance, one IST month at a time, from the month of their first
 * attendance day to this one (owner decision 2026-09-24). The last 7 days carry **Add note**
 * (an overtime note, or "I worked that day" on a day off, 3b.2), since the strip on the home
 * screen is one line.
 */
export default async function LeaveAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = todayIST();
  // Keyed by the session's id, so they start with the session read (ARCHITECTURE §19).
  const noteDaysRead = getNoteDays(today);
  const [viewer, [{ month: requested }, own]] = await checkThenRead(
    requirePermission("attendance.self"),
    Promise.all([searchParams, withSessionUserId(getOwnMember), noteDaysRead]),
  );
  // Attendance starts the IST day after joining (WORKFLOWS §1, 2.2).
  const firstDay = own?.joinedAt ? addISTDays(toISTDate(own.joinedAt), 1) : today;
  const { month, previous, next } = historyMonth(requested, {
    first: monthOf(firstDay),
    current: monthOf(today),
  });
  const [days, noteDays] = await Promise.all([listDays(viewer.id, month), noteDaysRead]);
  const href = (m: string) => `/leave/attendance?month=${m}`;

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
        noteDays={noteDays}
      />
    </>
  );
}
