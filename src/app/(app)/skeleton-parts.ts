import {
  MonthSummarySkeleton,
  PersonTodayLineSkeleton,
  TodayAttendanceStripSkeleton,
  TodayCardSkeleton,
} from "@/modules/attendance";
import { CalendarSkeleton } from "@/modules/calendar";
import { DELIVERABLE_COLUMNS } from "@/modules/client-work";
import {
  DashSectionHeadingSkeleton,
  DayColumns,
  PhoneDateLine,
  ThisWeekSkeleton,
} from "@/modules/dashboards";
import { PROJECT_ROW_STATE } from "@/core/ui/composites/row-metrics";
import { LeaveBalanceStripSkeleton } from "@/modules/leave";
import { TaskRowsSkeleton, TaskSectionHeadingSkeleton } from "@/modules/tasks";

/**
 * The modules' parts of the screens' loading screens (v7.0, the tap drawings): each screen's
 * skeleton is one component (`today-skeleton.tsx` and the rest) that its `loading.tsx` renders on
 * the server and the tap drawings render in the browser (`tap-drawings.tsx`), so the two never
 * differ. The parts come in as this object because the two sides reach the modules differently:
 * the server through each module's public API (here), the browser through each module's client
 * kit (`components/tap-kit.tsx`, ADR-0011 amendment: a barrel would bring the module's reads).
 * They are the same components.
 */
export interface SkeletonParts {
  CalendarSkeleton: typeof CalendarSkeleton;
  DashSectionHeadingSkeleton: typeof DashSectionHeadingSkeleton;
  DayColumns: typeof DayColumns;
  DELIVERABLE_COLUMNS: string;
  LeaveBalanceStripSkeleton: typeof LeaveBalanceStripSkeleton;
  MonthSummarySkeleton: typeof MonthSummarySkeleton;
  PersonTodayLineSkeleton: typeof PersonTodayLineSkeleton;
  PhoneDateLine: typeof PhoneDateLine;
  PROJECT_ROW_STATE: string;
  TaskRowsSkeleton: typeof TaskRowsSkeleton;
  TaskSectionHeadingSkeleton: typeof TaskSectionHeadingSkeleton;
  ThisWeekSkeleton: typeof ThisWeekSkeleton;
  TodayAttendanceStripSkeleton: typeof TodayAttendanceStripSkeleton;
  TodayCardSkeleton: typeof TodayCardSkeleton;
}

/** The parts as the loading screens render them on the server. */
export const SERVER_PARTS: SkeletonParts = {
  CalendarSkeleton,
  DashSectionHeadingSkeleton,
  DayColumns,
  DELIVERABLE_COLUMNS,
  LeaveBalanceStripSkeleton,
  MonthSummarySkeleton,
  PersonTodayLineSkeleton,
  PhoneDateLine,
  PROJECT_ROW_STATE,
  TaskRowsSkeleton,
  TaskSectionHeadingSkeleton,
  ThisWeekSkeleton,
  TodayAttendanceStripSkeleton,
  TodayCardSkeleton,
};
