"use client";

import { useEffect, useState } from "react";

import type { Result } from "@/core/errors";
import { getInBackground } from "@/core/http/background";
import { ReviewFacts } from "@/core/ui/composites/review-sheet";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { todayIST } from "@/core/time";

import { reviewWeek, type ReviewContext } from "../domain/review-context";

import { ReviewWeek } from "./review-week";

/** Approvals' Review context (B4): the same background read, `?day=<id>`. */
const CONTEXT_URL = "/api/attendance/review-context";

/**
 * A waiting day's context on the person page's day sheet (PP-person-4): the same as Approvals'
 * Review panel shows, read when the sheet opens: their comp leave and their week around the day
 * (their note is in the day's timeline above it). Mounted with the sheet, so each opening reads
 * afresh.
 */
export function DayReviewContext({ dayId, workDate }: { dayId: string; workDate: string }) {
  const [context, setContext] = useState<Result<ReviewContext> | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void getInBackground<ReviewContext>(CONTEXT_URL, { day: dayId }).then((result) => {
      if (live) setContext(result);
    });
    return () => {
      live = false;
    };
  }, [dayId]);
  return (
    <div data-slot="day-review-context" className="flex flex-col">
      <ReviewFacts
        facts={[
          {
            label: "Comp leave",
            value: context?.ok ? (
              context.data.compLeave
            ) : context ? (
              "Not loaded"
            ) : (
              <Skeleton className="ml-auto h-4 w-28" />
            ),
          },
        ]}
      />
      <ReviewWeek context={context} lines={reviewWeek([], workDate, todayIST()).length} />
    </div>
  );
}
