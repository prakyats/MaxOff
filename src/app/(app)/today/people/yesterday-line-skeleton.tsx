"use client";

import { useSearchParams } from "next/navigation";

import { todayIST } from "@/core/time";

import { showsYesterday, YESTERDAY_LINE_CLASS, yesterdayLine } from "./yesterday";

/**
 * The board's loading screen on "End not recorded": the line about yesterday, its own words
 * unseen with a bar per line, so it wraps to exactly the page's lines at every width and text
 * size. A `loading.tsx` gets no search params, so it reads the address it is loading (the target
 * address, also on a client navigation).
 */
export function YesterdayLineSkeleton() {
  const params = useSearchParams();
  if (!showsYesterday(params.getAll("group"))) return null;
  return (
    <p aria-hidden data-slot="loading-people-yesterday" className={YESTERDAY_LINE_CLASS}>
      <span className="bg-muted rounded-md box-decoration-clone text-transparent select-none motion-safe:animate-pulse">
        {yesterdayLine(todayIST())}
      </span>
    </p>
  );
}
