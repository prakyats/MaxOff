import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { type StandIn, STAND_INS } from "./stand-ins";

/**
 * How many lines a stand-in's message takes, measured in Chromium against the built app on
 * 2026-09-29 (`/review-phase 3c`): at 375px the message column is 295px wide (16px gutters, the
 * box's `px-6`), at 430px it is 350px, and from 464px up it is `max-w-sm` (384px), the desktop
 * width. The title is one line everywhere. A copy change in `stand-ins.ts` re-measures these.
 */
type StandInLines = {
  /** Below 430px (a 375px phone). */
  phone: number;
  /** From 430px to 463px (a 430px phone). */
  phoneLg: number;
  /** From 464px up, where the message reaches `max-w-sm`. */
  wide: number;
};

const STAND_IN_LINES: Record<keyof typeof STAND_INS, StandInLines> = {
  tasksMine: { phone: 3, phoneLg: 3, wide: 2 },
  tasksTeam: { phone: 3, phoneLg: 3, wide: 3 },
  approvalsAdmin: { phone: 3, phoneLg: 3, wide: 3 },
  alertsMember: { phone: 4, phoneLg: 4, wide: 3 },
  alertsOwner: { phone: 3, phoneLg: 2, wide: 2 },
  calendar: { phone: 3, phoneLg: 2, wide: 2 },
  reportsAdmin: { phone: 3, phoneLg: 2, wide: 2 },
  todayOwner: { phone: 2, phoneLg: 2, wide: 2 },
  todayAdmin: { phone: 3, phoneLg: 3, wide: 3 },
  myDay: { phone: 3, phoneLg: 3, wide: 3 },
};

const LINES_BY_COPY = new Map<StandIn, StandInLines>(
  (Object.keys(STAND_INS) as (keyof typeof STAND_INS)[]).map((key) => [
    STAND_INS[key],
    STAND_IN_LINES[key],
  ]),
);

/**
 * The tracing of a stand-in screen while it loads (`/review-phase 3c`, owner decision: a
 * stand-in route's `loading.tsx` traces the stand-in that renders now, not the future screen;
 * ARCHITECTURE §14.1). On a phone `PageHeader` is the title bar alone, so what a stand-in route
 * shows is the `EmptyState` of `PlaceholderPage` (`core/ui/composites/empty-state.tsx`): a dashed
 * `rounded-lg` box, `px-6 py-12`, centred, a 40px circle with `mb-3`, one `text-sm` title line
 * (20px) and a `text-sm max-w-sm` message with `mt-1`, whose line count is `STAND_IN_LINES`'.
 * The same geometry here, so nothing moves when the copy lands. Rows past a width's count are
 * hidden from that width up, so one skeleton fits 375, 430 and the desktop.
 *
 * When a phase builds the real screen (4.5 Tasks and the Admin's Approvals, 5.1 Alerts, 6.1 My
 * Day, 6.2 Today, 6.4 Calendar, 6.5 / 9.3 Reports), its `loading.tsx` goes back to the
 * owner-specified shape (`loading-routes.test.ts`).
 */
export function StandInSkeleton({ copy, label }: { copy: StandIn; label: string }) {
  const lines = LINES_BY_COPY.get(copy) ?? { phone: 3, phoneLg: 3, wide: 3 };
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-slot="loading-stand-in"
      data-lines={`${lines.phone}/${lines.phoneLg}/${lines.wide}`}
      className="border-border flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center"
    >
      <Skeleton className="mb-3 size-10 shrink-0 rounded-full" />
      {/* `w-full` under `max-w-48`: at 200% system text 12rem is wider than a 375px column. */}
      <div className="flex h-5 w-full max-w-48 items-center justify-center">
        <Skeleton className="h-3.5 w-full" />
      </div>
      <div className="mt-1 flex w-full max-w-sm flex-col items-center">
        {Array.from({ length: lines.phone }, (_, i) => (
          <div
            key={i}
            data-slot="loading-stand-in-line"
            className={cn(
              "flex h-5 w-full items-center justify-center",
              i >= lines.phoneLg && "min-[430px]:hidden",
              i >= lines.wide && i < lines.phoneLg && "min-[464px]:hidden",
            )}
          >
            <Skeleton className={cn("h-3", i === lines.phone - 1 ? "w-3/4" : "w-full")} />
          </div>
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
