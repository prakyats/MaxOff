import { type ReactNode, Suspense } from "react";

import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { PersonMenu } from "@/modules/team/components/person-menu";

import { PersonTabs } from "./person-nav";
import { loadPerson, showsHistory } from "./person";

const BACK = { href: "/people", label: "People" };

/**
 * A person's page (kickoff 3, task 3.4): **Profile** for everyone with `team.view`, and for the
 * Owner **Leave**, **Attendance** (2.4) and **Month** (3b.4) once the person has joined and is
 * not the Owner. One
 * header and tab bar over the views; **they live here, not in the pages** (2.7b), so a tab
 * switch swaps only the view below them. The header carries the Owner's ⋯ menu (Edit,
 * Deactivate and the rest, owner decision 2026-09-25).
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
  return (
    <>
      <Suspense
        fallback={
          <>
            <PageHeader title={<Skeleton className="h-5 w-40" />} back={BACK} />
            {can(viewer.role, "attendance.view_all") ? <TabsSkeleton /> : null}
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
      <PageHeader
        title={person.fullName}
        description={person.jobTitle ?? undefined}
        back={BACK}
        menu={
          can(viewer.role, "team.manage") ? (
            <PersonMenu member={person} viewerId={viewer.id} />
          ) : undefined
        }
      />
      {showsHistory(viewer, person) ? <PersonTabs memberId={person.id} /> : null}
    </>
  );
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
