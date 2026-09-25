import { type ReactNode, Suspense } from "react";

import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { PersonTabs } from "./person-nav";
import { loadPerson } from "./person";

const BACK = { href: "/people", label: "People" };

/**
 * One person's history for the Owner (task 2.4): two views, `/people/[id]` (requests) and
 * `/people/[id]/attendance` (the month), under one header and tab bar, like the member's own
 * /leave. **The header and tabs live here, not in the pages** (2.7b): switching the tabs swaps
 * only the view below them, so neither is rebuilt nor replaced by a skeleton on a switch.
 *
 * It awaits nothing but the route's id: the name streams in behind its own title skeleton, so a
 * drill-down from People paints this screen's shape at once instead of falling back to the
 * People list's skeleton above it. Each view's `loading.tsx` traces only the view.
 */
export default async function PersonLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <Suspense fallback={<PageHeader title={<Skeleton className="h-5 w-40" />} back={BACK} />}>
        <PersonHeader id={id} />
      </Suspense>
      <PersonTabs memberId={id} />
      {children}
    </>
  );
}

async function PersonHeader({ id }: { id: string }) {
  const person = await loadPerson(id);
  return (
    <PageHeader title={person.fullName} description={person.jobTitle ?? undefined} back={BACK} />
  );
}
