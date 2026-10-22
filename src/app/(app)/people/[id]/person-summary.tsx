import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/** "4", "2½": halves are the only fractions a day count has. */
function days(value: number): string {
  const whole = Math.floor(value);
  if (Math.round((value - whole) * 2) !== 1) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

export const SUMMARY_CLASS =
  "border-border bg-card shadow-raised divide-border grid grid-cols-3 divide-x overflow-hidden rounded-lg border";
const CELL_CLASS = "flex min-h-20 min-w-0 flex-col gap-0.5 px-3 py-3 sm:px-4";

/**
 * A person's summary for the Owner (PP-person-3, major change 8): before Profile, what needs him
 * about them: the days waiting for his review (opening their Attendance, where each has Approve),
 * the leave they took this month and the comp leave they have left (opening Leave). Their today
 * is the line above the tabs. The figures are one step up and tabular (FINAL 3). A view link: the
 * tabs replace the address, so one back still returns to where the Owner came from (§14.2 d).
 */
export function PersonSummary({
  memberId,
  waiting,
  leave,
  compLeft,
  monthName,
}: {
  memberId: string;
  waiting: number;
  leave: number;
  compLeft: number;
  monthName: string;
}) {
  const cells = [
    {
      key: "waiting",
      figure: days(waiting),
      label: waiting === 1 ? "Day waiting for you" : "Days waiting for you",
      href: `/people/${memberId}/attendance`,
      attention: waiting > 0,
    },
    {
      key: "leave",
      figure: days(leave),
      label: `Leave in ${monthName}`,
      href: `/people/${memberId}/leave`,
      attention: false,
    },
    {
      key: "comp",
      figure: days(compLeft),
      label: "Comp leave left",
      href: `/people/${memberId}/leave`,
      attention: false,
    },
  ];
  return (
    <section aria-label="Summary" data-slot="person-summary">
      <ul className={SUMMARY_CLASS}>
        {cells.map((cell) => (
          <li key={cell.key} className="min-w-0">
            <ViewLink
              href={cell.href}
              scroll={false}
              data-slot="person-summary-cell"
              data-cell={cell.key}
              className={cn(
                CELL_CLASS,
                "active:bg-muted/60 hover:bg-muted/40 focus-visible:ring-ring h-full outline-none focus-visible:ring-2 focus-visible:ring-inset",
              )}
            >
              <span className="flex items-start justify-between gap-1">
                <span
                  className={cn(
                    "text-xl font-semibold tabular-nums",
                    cell.attention && "text-attention",
                  )}
                >
                  {cell.figure}
                </span>
                <ChevronRightIcon
                  className="text-muted-foreground mt-1 size-4 shrink-0"
                  aria-hidden
                />
              </span>
              <span className="text-muted-foreground text-xs break-words">{cell.label}</span>
              {cell.key === "waiting" && waiting > 0 ? (
                <span className="text-xs font-medium underline underline-offset-4">Review</span>
              ) : null}
            </ViewLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The summary while it loads: its three cells (the Owner's Profile tab). */
export function PersonSummarySkeleton() {
  return (
    <div aria-hidden className={SUMMARY_CLASS}>
      {[0, 1, 2].map((cell) => (
        <div key={cell} className={CELL_CLASS}>
          <span className="flex h-7 items-center">
            <Skeleton className="h-5 w-8" />
          </span>
          <span className="flex h-4 items-center">
            <Skeleton className="h-3 w-20 max-w-full" />
          </span>
        </div>
      ))}
    </div>
  );
}
