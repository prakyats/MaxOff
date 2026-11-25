import { can } from "@/core/permissions";
import type { DrawVariant } from "@/core/ui/navigation/tap-drawings";
import type { ShellRole } from "@/core/ui/shell/viewer";
import { CalendarSkeleton } from "@/modules/calendar/components/tap-kit";

import { CalendarLoading } from "../calendar/calendar-loading";

/**
 * The calendar's tap drawing (v7.0): its loading screen on today's month's rows (`weeks`, counted
 * by the layout on the server: the month's own code here would join the calendar's first load),
 * no date named.
 */
export function drawCalendar(role: ShellRole, weeks: number): DrawVariant {
  const drawing: DrawVariant = () => (
    <CalendarLoading
      parts={{ CalendarSkeleton }}
      weeks={weeks}
      month={null}
      switcher={can(role, "attendance.view_all") || can(role, "availability.view")}
    />
  );
  return drawing;
}
