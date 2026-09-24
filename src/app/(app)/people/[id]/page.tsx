import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { LEAVE_PAGE_SIZE, LeaveRequestList, listRequests } from "@/modules/leave";

import { LeavePager } from "../../leave/leave-nav";

import { PersonTabs } from "./person-nav";
import { loadPerson } from "./person";

export const metadata: Metadata = { title: "Attendance & leave" };

/**
 * One person's leave requests, newest first, 20 at a time, for the Owner (task 2.4): the same
 * list the member sees on /leave, in the Owner's words, with Edit and Cancel on approved leave.
 * Reached from the people board on /today and from People; a real drill-down, so back returns
 * there (ARCHITECTURE §14.2 b).
 */
export default async function PersonLeavePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { page: requested }] = await Promise.all([params, searchParams]);
  const person = await loadPerson(id);
  const page =
    typeof requested === "string" && /^[1-9]\d{0,4}$/.test(requested) ? Number(requested) : 1;
  const { requests, total } = await listRequests(person.id, page);
  const pages = Math.max(1, Math.ceil(total / LEAVE_PAGE_SIZE));
  const base = `/people/${person.id}`;
  if (page > pages) redirect(base);

  return (
    <>
      <PageHeader
        title={person.fullName}
        description={person.jobTitle ?? undefined}
        back={{ href: "/people", label: "People" }}
      />
      <PersonTabs memberId={person.id} />
      {pages > 1 ? (
        <LeavePager
          label={`Page ${page} of ${pages}`}
          previous={page > 1 ? (page === 2 ? base : `${base}?page=${page - 1}`) : null}
          next={page < pages ? `${base}?page=${page + 1}` : null}
          previousLabel="Newer requests"
          nextLabel="Older requests"
        />
      ) : null}
      <LeaveRequestList requests={requests} today={todayIST()} owner={{ name: person.fullName }} />
    </>
  );
}
