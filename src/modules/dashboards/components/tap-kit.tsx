"use client";

/**
 * What the app's tap drawings need from the dashboards (`app/(app)/drawings/`, v7.0): the parts
 * Today's, My Day's and Tasks' loading screens are made of, client-side in one file (ADR-0011
 * amendment), the same components those loading screens render on the server. From the file of
 * skeletons only (`day-skeletons.tsx`).
 */
export {
  DashSectionHeadingSkeleton,
  DayColumns,
  PhoneDateLine,
  ThisWeekSkeleton,
} from "./day-skeletons";
