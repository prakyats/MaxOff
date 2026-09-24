import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requirePermission } from "@/core/permissions/server";
import { addISTDays, todayIST, toISTDate } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  AttendanceHistory,
  historyMonth,
  listOwnDays,
  monthLabel,
  monthOf,
} from "@/modules/attendance";
import {
  LEAVE_PAGE_SIZE,
  LeaveRequestList,
  listOwnRequests,
  RequestLeaveButton,
} from "@/modules/leave";
import { getOwnMember } from "@/modules/team";

import { LeavePager, type LeaveTab, LeaveTabs } from "./leave-nav";

export const metadata: Metadata = { title: "Attendance & leave" };

const DESCRIPTION = "Request leave, change or cancel it, and see how each day was recorded.";

/**
 * The member's own attendance and leave (task 2.3, WORKFLOWS §1/§2). Personal, not
 * operations, so it has no tab or sidebar entry (owner decision 2026-09-24): the attendance
 * card on My Day and /today, and a row on Me, lead here. Only whoever marks attendance
 * (`attendance.self`, Admins and Staff) opens it; the Owner's view of people is 2.4.
 */
export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requirePermission("attendance.self");
  const params = await searchParams;
  const tab: LeaveTab = params.tab === "attendance" ? "attendance" : "requests";
  const today = todayIST();

  return (
    <>
      <PageHeader
        title="Attendance & leave"
        description={DESCRIPTION}
        help={DESCRIPTION}
        actions={<RequestLeaveButton today={today} />}
      />
      <LeaveTabs active={tab} />
      {tab === "requests" ? (
        <RequestsTab memberId={viewer.id} page={params.page} today={today} />
      ) : (
        <AttendanceTab memberId={viewer.id} month={params.month} today={today} />
      )}
    </>
  );
}

async function RequestsTab({
  memberId,
  page: requested,
  today,
}: {
  memberId: string;
  page: string | string[] | undefined;
  today: string;
}) {
  const page =
    typeof requested === "string" && /^[1-9]\d{0,4}$/.test(requested) ? Number(requested) : 1;
  const { requests, total } = await listOwnRequests(memberId, page);
  const pages = Math.max(1, Math.ceil(total / LEAVE_PAGE_SIZE));
  // A page that no longer exists (the list got shorter): the first one.
  if (page > pages) redirect("/leave");

  return (
    <>
      <LeavePager
        label={
          pages > 1
            ? `Page ${page} of ${pages}`
            : `${total} ${total === 1 ? "request" : "requests"}`
        }
        previous={page > 1 ? (page === 2 ? "/leave" : `/leave?page=${page - 1}`) : null}
        next={page < pages ? `/leave?page=${page + 1}` : null}
        previousLabel="Newer requests"
        nextLabel="Older requests"
      />
      <LeaveRequestList requests={requests} today={today} />
    </>
  );
}

async function AttendanceTab({
  memberId,
  month: requested,
  today,
}: {
  memberId: string;
  month: string | string[] | undefined;
  today: string;
}) {
  const own = await getOwnMember(memberId);
  // Attendance starts the IST day after joining (WORKFLOWS §1, 2.2).
  const firstDay = own?.joinedAt ? addISTDays(toISTDate(own.joinedAt), 1) : today;
  const { month, previous, next } = historyMonth(requested, {
    first: monthOf(firstDay),
    current: monthOf(today),
  });
  const days = await listOwnDays(memberId, month);
  const href = (m: string) => `/leave?tab=attendance&month=${m}`;

  return (
    <>
      <LeavePager
        label={monthLabel(month)}
        previous={previous ? href(previous) : null}
        next={next ? href(next) : null}
        previousLabel="Previous month"
        nextLabel="Next month"
      />
      <AttendanceHistory days={days} monthName={monthLabel(month)} />
    </>
  );
}
