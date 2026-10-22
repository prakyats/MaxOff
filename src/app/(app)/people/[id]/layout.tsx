import { type ReactNode, Suspense } from "react";

import { startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { DetailHeader, PageHeader } from "@/core/ui/composites/page-header";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { getTodayPeople, PersonTodayLine, PersonTodayLineSkeleton } from "@/modules/attendance";
import { STATUS_LABELS } from "@/modules/team";
import { PersonMenu } from "@/modules/team/components/person-menu";
import { RecordReadReceipt } from "@/modules/notifications-center";

import { PersonHistoryButton } from "./person-history";
import { PersonTabs } from "./person-nav";
import { loadPerson, showsHistory } from "./person";

/**
 * People is the parent; a person is opened from these screens too, and back returns to the one it
 * came from and names it (§14.2 k, 6b.12).
 */
const BACK = {
  href: "/people",
  label: "People",
  from: [
    { path: "/today/people", label: "Everyone today" },
    { path: "/today", label: "Today" },
    { path: "/approvals", label: "Approvals" },
    { path: "/reports/month", label: "Month" },
    { path: "/reports/end-of-day/*", label: "End of day" },
  ],
};

/**
 * A person's page (kickoff 3, task 3.4): **Profile** for everyone with `team.view`, and for the
 * Owner **Leave**, **Attendance** (2.4) and **Month** (3b.4) once the person has joined and is
 * not the Owner. One
 * header and tab bar over the views; **they live here, not in the pages** (2.7b), so a tab
 * switch swaps only the view below them. The header carries the Owner's ⋯ menu (Edit,
 * Deactivate and the rest, owner decision 2026-09-25). For the Owner, the person's today sits in
 * one line above the tabs (6.2: state, start and end, overtime; Kickoff 6 decision 7).
 *
 * It awaits only the route's id and the viewer (already read for the shell): the header and
 * tabs stream in behind a skeleton of themselves (the tab bar's for the Owner, who nearly always
 * gets one), so a drill-down from People paints this screen's shape at once. Each view's
 * `loading.tsx` traces only the view.
 */
export default async function PersonLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer] = await Promise.all([params, requirePermission("team.view")]);
  // The Owner's today line reads the board (`cache()`d): started with the header's reads.
  if (can(viewer.role, "attendance.view_all")) startEarly(getTodayPeople());
  return (
    <>
      <Suspense fallback={null}>
        <RecordReadReceipt entity="members" id={id} />
      </Suspense>
      <Suspense
        fallback={
          <>
            <PageHeader
              title={<Skeleton className="h-5 w-40" />}
              back={BACK}
              status={<Skeleton className="h-5 w-16 rounded-full" />}
              menu={
                can(viewer.role, "team.manage") ? (
                  <>
                    <Skeleton aria-hidden className="size-11 rounded-lg" />
                    <Skeleton aria-hidden className="size-11 rounded-lg" />
                  </>
                ) : undefined
              }
            />
            {can(viewer.role, "attendance.view_all") ? (
              <>
                <PersonTodayLineSkeleton />
                <TabsSkeleton />
              </>
            ) : null}
          </>
        }
      >
        <PersonHeader id={id} />
      </Suspense>
      {children}
    </>
  );
}

async function PersonHeader({ id }: { id: string }) {
  const { viewer, person } = await loadPerson(id);
  return (
    <>
      {/* FINAL 6 / PP-person-1: back · name · status chip, then the History clock (the Owner's:
          the audit log is his to read) and ⋯. The history is read only when it opens. */}
      <DetailHeader
        title={person.fullName}
        description={person.jobTitle ?? undefined}
        back={BACK}
        status={<StatusBadge status={person.status} label={STATUS_LABELS[person.status]} />}
        menu={
          can(viewer.role, "activity.view_all") || can(viewer.role, "team.manage") ? (
            <>
              {can(viewer.role, "activity.view_all") ? (
                <PersonHistoryButton memberId={person.id} />
              ) : null}
              {can(viewer.role, "team.manage") ? (
                <PersonMenu member={person} viewerId={viewer.id} />
              ) : null}
            </>
          ) : undefined
        }
      />
      {showsHistory(viewer, person) ? (
        <>
          {/* Their today in one line above the tabs (6.2, Kickoff 6 decision 7): the Owner's only. */}
          {can(viewer.role, "attendance.view_all") ? <PersonToday id={person.id} /> : null}
          <PersonTabs memberId={person.id} />
        </>
      ) : null}
    </>
  );
}

/** The person's today, from the board's read (`getTodayPeople()`, `cache()`d per request). */
async function PersonToday({ id }: { id: string }) {
  const today = await getTodayPeople();
  return <PersonTodayLine person={today.people.find((person) => person.memberId === id) ?? null} />;
}

/** The tab bar's shape while the person loads: four 44px cells, as `PersonTabs` draws them. */
function TabsSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="loading-person-tabs"
      className="bg-muted mb-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,4.5rem),1fr))] gap-1 rounded-lg p-1 md:inline-grid md:w-[32rem]"
    >
      {[0, 1, 2, 3].map((cell) => (
        <div key={cell} className="flex min-h-11 items-center justify-center">
          <Skeleton className="h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}
