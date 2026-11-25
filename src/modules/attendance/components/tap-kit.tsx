"use client";

/**
 * What the app's tap drawings need from attendance (`app/(app)/drawings/`, v7.0): the skeletons
 * in Today's, My Day's and a person's loading screens, client-side in one file (ADR-0011
 * amendment), the same components the loading screens render on the server. Each from a file of
 * skeletons only: a module the screens also load for their live parts would carry the drawings'
 * exports into their first load.
 */
export { MonthSummarySkeleton } from "./month-summary-skeleton";
export { PersonTodayLineSkeleton, TodayCardSkeleton } from "./today-board-skeleton";
export { TodayAttendanceStripSkeleton } from "./today-attendance-strip-skeleton";
