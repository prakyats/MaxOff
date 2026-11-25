import type { ReactNode } from "react";

import { PageHeader } from "@/core/ui/composites/page-header";

import type { SkeletonParts } from "../skeleton-parts";

/**
 * My Day as it renders (6.1), traced (ARCHITECTURE §14.1): the one-line attendance strip first
 * (`TodayAttendanceStripSkeleton`, ROADMAP 6.1), then the first exception section: its heading
 * and two `TaskRow`s (`TaskRowsSkeleton`), the shape every section under the strip shares; the
 * date line, and "This week" as the right column from an 896 px content width (`DayColumns`, V5b
 * major change 1). One component for the route's `loading.tsx` and its tap drawing (v7.0):
 * `context` and `line` are the header's words on the server and bars in a drawing.
 */
export function MyDaySkeleton({
  parts,
  strip,
  context,
  line,
}: {
  parts: Pick<
    SkeletonParts,
    | "DashSectionHeadingSkeleton"
    | "DayColumns"
    | "PhoneDateLine"
    | "TaskRowsSkeleton"
    | "ThisWeekSkeleton"
    | "TodayAttendanceStripSkeleton"
  >;
  strip: boolean;
  context: ReactNode;
  line: ReactNode;
}) {
  const {
    DashSectionHeadingSkeleton,
    DayColumns,
    PhoneDateLine,
    TaskRowsSkeleton,
    ThisWeekSkeleton,
    TodayAttendanceStripSkeleton,
  } = parts;
  return (
    <>
      <PageHeader title="My Day" description={context} />
      <PhoneDateLine line={line} />
      {strip ? <TodayAttendanceStripSkeleton /> : null}
      <DayColumns
        slot="loading-my-day"
        loading="Loading My Day"
        week={<ThisWeekSkeleton />}
        main={
          <>
            <section className="flex min-w-0 flex-col gap-2">
              <DashSectionHeadingSkeleton />
              <TaskRowsSkeleton rows={2} label="Your tasks" />
            </section>
            <span className="sr-only">Loading My Day</span>
          </>
        }
      />
    </>
  );
}
