import { can } from "@/core/permissions";
import type { DrawVariant } from "@/core/ui/navigation/tap-drawings";
import type { ShellRole } from "@/core/ui/shell/viewer";
import {
  TodayAttendanceStripSkeleton,
  TodayCardSkeleton,
} from "@/modules/attendance/components/tap-kit";
import {
  DashSectionHeadingSkeleton,
  DayColumns,
  PhoneDateLine,
  ThisWeekSkeleton,
} from "@/modules/dashboards/components/tap-kit";
import { TaskRowsSkeleton } from "@/modules/tasks/components/tap-kit";

import { MyDaySkeleton } from "../my-day/my-day-skeleton";
import { DATE_LINE_BAR, DAY_CONTEXT_BAR, TodaySkeleton } from "../today/today-skeleton";

const PARTS = {
  DashSectionHeadingSkeleton,
  DayColumns,
  PhoneDateLine,
  TaskRowsSkeleton,
  ThisWeekSkeleton,
  TodayAttendanceStripSkeleton,
  TodayCardSkeleton,
};

/** Today's tap drawing (v7.0): its loading screen, bars for the date and the greeting. */
export function drawToday(role: ShellRole): DrawVariant {
  const drawing: DrawVariant = () => (
    <TodaySkeleton
      parts={PARTS}
      owner={can(role, "attendance.view_all")}
      strip={can(role, "attendance.self")}
      context={DAY_CONTEXT_BAR}
      line={DATE_LINE_BAR}
    />
  );
  return drawing;
}

/** My Day's tap drawing (v7.0): the same day parts as Today's, so one chunk holds both. */
export function drawMyDay(role: ShellRole): DrawVariant {
  const drawing: DrawVariant = () => (
    <MyDaySkeleton
      parts={PARTS}
      strip={can(role, "attendance.self")}
      context={DAY_CONTEXT_BAR}
      line={DATE_LINE_BAR}
    />
  );
  return drawing;
}
