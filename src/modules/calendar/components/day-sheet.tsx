"use client";

import type { ReactNode } from "react";

import type { ISODate } from "@/core/time";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";

import { type CalendarDay, type CalendarScope, dayHeading } from "../domain/calendar";
import { DayDetail } from "./day-detail";

/**
 * The day sheet (6.4b; Kickoff 6 decision 25 D): a day of the phone's full month, or of the
 * laptop's month or week, opened over the calendar: a bottom sheet on a phone, a dialog from `md`
 * up. A layer (ARCHITECTURE §14.2 a): back closes it; a task in it opens with the sheet's entry
 * backed out first (`OverlayLink`), so back from the task lands on the calendar. Loaded after the
 * page, on its first opening (§19).
 */
export function DaySheet({
  day,
  today,
  scope,
  free,
  action,
  footer,
  onClose,
}: {
  day: CalendarDay;
  today: ISODate;
  scope: CalendarScope;
  free: string | null;
  action: ReactNode;
  /** "Open day" on the laptop. */
  footer?: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="md:max-w-lg" data-calendar="day-sheet" data-date={day.date}>
        <DialogHeader>
          <DialogTitle>{dayHeading(day.date, today)}</DialogTitle>
          <DialogDescription className="sr-only">
            What is on this day, and what you can do on it.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70svh] min-w-0 overflow-y-auto">
          <DayDetail
            day={day}
            today={today}
            scope={scope}
            free={free}
            action={action}
            footer={footer}
            timeline
            heading={false}
            headingId={`sheet-${day.date}`}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
