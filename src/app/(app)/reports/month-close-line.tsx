import { CalendarClockIcon, ChevronRightIcon } from "lucide-react";

import { DrillLink } from "@/core/ui/composites/drill-link";
import {
  closeHref,
  type MonthReminder,
  monthReminderAction,
  monthReminderLine,
} from "@/modules/revenue";

/**
 * The Owner's month close reminder on Reports (v3.5 U6; decision 19, v3.5 Q9; WORKFLOWS §7.3):
 * "September isn't closed yet" or "September and 1 more month aren't closed yet", opening the
 * close screen of the oldest month, which its second line names ("Close September"). The month
 * only, never an amount. Nothing when none is due.
 */
export function MonthCloseLine({
  reminder,
  today,
}: {
  reminder: MonthReminder | null;
  today: string;
}) {
  if (!reminder) return null;
  return (
    <DrillLink
      href={closeHref(reminder.month)}
      data-slot="report-month-close"
      data-month={reminder.month.slice(0, 7)}
      className="border-border bg-card shadow-raised focus-visible:ring-ring flex min-h-12 items-center gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium outline-none focus-visible:ring-2"
    >
      <CalendarClockIcon aria-hidden className="text-attention size-4 shrink-0" />
      <span className="min-w-0 flex-1 break-words">
        <span data-slot="report-month-close-text">{monthReminderLine(reminder, today)}</span>
        <span className="text-muted-foreground block text-xs font-normal">
          {monthReminderAction(reminder, today)}
        </span>
      </span>
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </DrillLink>
  );
}
