import { type ReactNode, Suspense } from "react";

import { startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { DetailHeader } from "@/core/ui/composites/page-header";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { getTodayPeople, PersonTodayLine } from "@/modules/attendance";
import { STATUS_LABELS } from "@/modules/team";
import { PersonMenu } from "@/modules/team/components/person-menu";
import { RecordReadReceipt } from "@/modules/notifications-center";

import { SERVER_PARTS } from "../../skeleton-parts";
import { PERSON_BACK } from "./back";
import { PersonHeaderSkeleton } from "./person-header-skeleton";
import { PersonHistoryButton } from "./person-history";
import { PersonTabs } from "./person-nav";
import { loadPerson, showsHistory } from "./person";

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
          <PersonHeaderSkeleton
            parts={SERVER_PARTS}
            manages={can(viewer.role, "team.manage")}
            owner={can(viewer.role, "attendance.view_all")}
          />
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
        back={PERSON_BACK}
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
        // Two header buttons (History and ⋯) beside the bell, as on the task page: at very large
        // text the bell wraps to a second row rather than pushing the bar past the screen's edge.
        className="flex-wrap"
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
