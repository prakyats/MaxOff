import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { LEAVE_PAGE_SIZE, listRequests } from "@/modules/leave";
import { LeaveRequestList } from "@/modules/leave/components/leave-request-list";

import { LeavePager } from "./leave-nav";

export const metadata: Metadata = { title: "Attendance & leave" };

/**
 * The member's own leave requests, newest first, 20 at a time (the layout holds the header and
 * the tabs). Only whoever marks attendance (`attendance.self`, Admins and Staff) opens it; the
 * Owner's view of people is 2.4. The pager appears only when there is more than one page.
 */
export default async function LeaveRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requirePermission("attendance.self");
  const { page: requested } = await searchParams;
  const page =
    typeof requested === "string" && /^[1-9]\d{0,4}$/.test(requested) ? Number(requested) : 1;
  const { requests, total } = await listRequests(viewer.id, page);
  const pages = Math.max(1, Math.ceil(total / LEAVE_PAGE_SIZE));
  // A page that no longer exists (the list got shorter): the first one.
  if (page > pages) redirect("/leave");

  return (
    <>
      {pages > 1 ? (
        <LeavePager
          label={`Page ${page} of ${pages}`}
          previous={page > 1 ? (page === 2 ? "/leave" : `/leave?page=${page - 1}`) : null}
          next={page < pages ? `/leave?page=${page + 1}` : null}
          previousLabel="Newer requests"
          nextLabel="Older requests"
        />
      ) : null}
      <LeaveRequestList requests={requests} today={todayIST()} />
    </>
  );
}
