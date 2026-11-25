import type { ReactNode } from "react";

import { ApprovalRowsSkeleton } from "@/core/ui/composites/approval-group-skeleton";
import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import type { SkeletonParts } from "../skeleton-parts";

/**
 * A tap drawing's stand-in for the header's line of context ("Thursday, 22 October · Hello,
 * Prishit") and the phone's date line: a bar of their size, since a drawing carries no name and
 * no date (v7.0, ARCHITECTURE §14.2 m).
 */
export const DAY_CONTEXT_BAR = (
  <Skeleton as="span" className="inline-block h-3.5 w-72 max-w-full align-middle" />
);
export const DATE_LINE_BAR = (
  <Skeleton as="span" className="inline-block h-3.5 w-40 align-middle" />
);

/**
 * Today as it renders (6.2, 6.3), traced per role (ARCHITECTURE §14.1). **The Owner's** (the Today
 * refresh, owner 2026-10-09): "Needs you", its heading and two compact approval rows (the same
 * row height, the kind label, the person's photo and title, the two meta lines, the one outlined button), then the
 * attendance section, its heading and the strip of four counts. Needs you always stands ("Nothing
 * needs you." when empty) and the card always follows it, so the first screen keeps this shape;
 * the sections after the card (My tasks, 6b.2; Today's tasks, Client work, Overdue and risks,
 * This week) are hidden when empty (decision 24), so they are drawn below the card only once their
 * data says they exist and nothing traced here moves. **An Admin's:** the one-line attendance strip, then "Needs
 * you": its heading and two `TaskRow`s (led by the primary owner's photo), then Client work (7.3): its heading and two rows. A Crew
 * member who types the address is taken to My Day, whose shape this is too (the strip and a
 * section). **V5b major change 1:** the header's date line (and the phone's), and the two
 * columns (`DayColumns`): from an 896 px content width "This week" is the right column, traced
 * (`ThisWeekSkeleton`); below that it sits under the rest, out of the first screen.
 *
 * One component for the route's `loading.tsx` and its tap drawing (v7.0): `context` and `line`
 * are the header's words on the server and bars in a drawing.
 */
export function TodaySkeleton({
  parts,
  owner,
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
    | "TodayCardSkeleton"
  >;
  owner: boolean;
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
    TodayCardSkeleton,
  } = parts;
  return (
    <>
      <PageHeader title="Today" description={context} />
      <PhoneDateLine line={line} />
      {strip ? <TodayAttendanceStripSkeleton /> : null}
      <DayColumns
        slot="loading-today"
        loading="Loading Today"
        week={<ThisWeekSkeleton />}
        main={
          <>
            <section className="flex min-w-0 flex-col gap-2">
              <DashSectionHeadingSkeleton />
              {owner ? (
                <ApprovalRowsSkeleton rows={2} avatars />
              ) : (
                <TaskRowsSkeleton rows={2} notes={2} label="Needs you" avatars />
              )}
            </section>
            {owner ? (
              <TodayCardSkeleton />
            ) : (
              // The Admin's Client work (7.3): its heading and two item rows (title over the project ·
              // client · date line and the stages in miniature, 6b.11) with their Mark done.
              <section
                className="flex min-w-0 flex-col gap-2"
                data-slot="loading-today-client-work"
              >
                <DashSectionHeadingSkeleton width="w-24" />
                <ul className="border-border divide-border bg-card shadow-raised divide-y rounded-lg border">
                  {[0, 1].map((row) => (
                    <li key={row} className="flex items-center gap-3 px-4 py-2">
                      <span className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-1.5">
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-3 w-2/3" />
                        <span className="flex items-center gap-2">
                          <Skeleton className="h-1.5 w-20 rounded-full" />
                          <Skeleton className="h-3 w-6" />
                        </span>
                      </span>
                      <Skeleton className="h-11 w-24 shrink-0 rounded-lg md:h-7" />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <span className="sr-only">Loading Today</span>
          </>
        }
      />
    </>
  );
}
