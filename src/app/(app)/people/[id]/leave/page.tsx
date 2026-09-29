import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { checkThenRead } from "@/core/lib/start-early";
import { todayIST } from "@/core/time";
import {
  CompLeaveCard,
  getCompBalance,
  LEAVE_PAGE_SIZE,
  listCredits,
  listRequests,
} from "@/modules/leave";
import { LeaveRequestList } from "@/modules/leave/components/leave-request-list";

import { LeavePager } from "../../../leave/leave-nav";

import { assertMemberId, loadHistoryPerson } from "../person";

export const metadata: Metadata = { title: "Attendance & leave" };

/**
 * One person's comp leave (3b.2: the balance, the credits, **Grant comp leave** and **Revoke**)
 * and their leave requests, newest first, 20 at a time, for the Owner (task 2.4): the same list
 * the member sees on /leave, in the Owner's words, with Edit and Cancel on approved leave.
 * Reached from the people board on /today and from People; a real drill-down, so back returns
 * there (ARCHITECTURE §14.2 b). The header and tabs are the layout's.
 */
export default async function PersonLeavePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { page: requested }] = await Promise.all([params, searchParams]);
  const page =
    typeof requested === "string" && /^[1-9]\d{0,4}$/.test(requested) ? Number(requested) : 1;
  const today = todayIST();
  // Keyed by the id in the URL: read together with the person (ARCHITECTURE §19); RLS decides
  // each read and `loadHistoryPerson` still decides the page.
  assertMemberId(id);
  const [person, [{ requests, total }, balance, credits]] = await checkThenRead(
    loadHistoryPerson(id),
    Promise.all([listRequests(id, page), getCompBalance(id), listCredits(id)]),
  );
  const pages = Math.max(1, Math.ceil(total / LEAVE_PAGE_SIZE));
  const base = `/people/${person.id}/leave`;
  if (page > pages) redirect(base);

  return (
    <>
      <CompLeaveCard
        balance={balance}
        credits={credits}
        today={today}
        owner={{ memberId: person.id, name: person.fullName }}
      />
      {pages > 1 ? (
        <LeavePager
          label={`Page ${page} of ${pages}`}
          previous={page > 1 ? (page === 2 ? base : `${base}?page=${page - 1}`) : null}
          next={page < pages ? `${base}?page=${page + 1}` : null}
          previousLabel="Newer requests"
          nextLabel="Older requests"
        />
      ) : null}
      <LeaveRequestList
        requests={requests}
        today={today}
        owner={{ name: person.fullName, compDays: balance.availableDays }}
      />
    </>
  );
}
