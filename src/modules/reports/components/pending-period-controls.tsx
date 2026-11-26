"use client";

import { useSearchParams } from "next/navigation";

import type { ISODate } from "@/core/time";

import { CUSTOM_MAX_DAYS, parsePeriod } from "../domain/work-report";
import { PeriodControls } from "./period-controls";

/**
 * A report's period switch on its loading screen (owner walk, v3.0 step 9): the period comes from
 * the address the reader is going to (a loading screen gets no search params of its own), so the
 * chosen segment and the line under it ("This month", "Week of 16 Nov") paint at once and stay put
 * when the report arrives. The same `parsePeriod` the page uses, so the two always agree.
 */
export function PendingPeriodControls({
  today,
  base = "/reports",
  maxDays = CUSTOM_MAX_DAYS,
  fallback = "week",
}: {
  today: ISODate;
  base?: string;
  /** The page's custom range limit (the Owner's reports: `OWNER_CUSTOM_MAX_DAYS`). */
  maxDays?: number;
  /** The kind the page opens on without one (the Owner's reports: "month"). */
  fallback?: "week" | "month";
}) {
  const params = useSearchParams();
  const period = parsePeriod(
    {
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      at: params.get("at") ?? undefined,
      period: params.get("period") ?? undefined,
    },
    today,
    maxDays,
    fallback,
  );
  return <PeriodControls period={period} today={today} base={base} />;
}
