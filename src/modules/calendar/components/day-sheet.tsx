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
import { useIsDesktop } from "@/core/ui/viewport/use-desktop";

import { type CalendarDay, type CalendarScope, dayHeading } from "../domain/calendar";
import { DayAgenda } from "./day-agenda";
import { DayDetail } from "./day-detail";

/**
 * The day sheet (6.4b; Kickoff 6 decision 25 D): a day of the phone's full month, or of the
 * laptop's month or week, opened over the calendar: a bottom sheet on a phone, a dialog from `md`
 * up. A layer (ARCHITECTURE §14.2 a): back closes it; a task in it opens with the sheet's entry
 * backed out first (`OverlayLink`), so back from the task lands on the calendar. Loaded after the
 * page, on its first opening (§19).
 *
 * **The phone's sheet** is the day's detail with its timeline, its body the sheet's scroll and the
 * day's action pinned in a row under it (the owner's decision of 2026-10-09, as under the week and
 * the compact month), never a scroll away; no action, no row. **The laptop's dialog** (the
 * owner's 2026-10-08 changes) has no timeline: a compact agenda (`DayAgenda`) whose body is the
 * dialog's one scroll, used only when the day is very full, and a footer pinned under it with the
 * day's buttons ("+ New task on 8 Oct" or "Suggest a task", and "Open day").
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
  // The sheet loads on its first opening, after hydration: the layout is known by then.
  const desktop = useIsDesktop() === true;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {desktop ? (
        <DialogContent
          className="flex max-w-lg flex-col gap-0 overflow-hidden p-0 md:max-w-lg md:p-0"
          data-calendar="day-sheet"
          data-layout="laptop"
          data-date={day.date}
        >
          <DialogHeader className="shrink-0 px-4 pt-4 pb-3 md:pr-12">
            <DialogTitle>{dayHeading(day.date, today)}</DialogTitle>
            <DialogDescription className="sr-only">
              What is on this day, and what you can do on it.
            </DialogDescription>
          </DialogHeader>
          <div data-slot="calendar-day-body" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <DayAgenda day={day} today={today} scope={scope} free={free} />
          </div>
          {action || footer ? (
            <div
              data-slot="calendar-day-footer"
              className="border-border flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-3"
            >
              {action}
              {footer}
            </div>
          ) : null}
        </DialogContent>
      ) : (
        // A column no wider than the sheet (a one-line row's min-content must not widen it past
        // the screen at large text): the title, the body as the sheet's one scroll, and the day's
        // action pinned under it. "Open day" (`footer`) is the laptop's only.
        <DialogContent
          className="flex flex-col overflow-hidden md:max-w-lg"
          data-calendar="day-sheet"
          data-date={day.date}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{dayHeading(day.date, today)}</DialogTitle>
            <DialogDescription className="sr-only">
              What is on this day, and what you can do on it.
            </DialogDescription>
          </DialogHeader>
          <div data-slot="calendar-day-body" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <DayDetail
              day={day}
              today={today}
              scope={scope}
              free={free}
              action={null}
              timeline
              heading={false}
              headingId={`sheet-${day.date}`}
            />
          </div>
          {action ? (
            <div
              data-slot="calendar-day-action"
              className="border-border -mx-4 flex min-w-0 shrink-0 items-center gap-2 border-t px-4 pt-3"
            >
              {action}
            </div>
          ) : null}
        </DialogContent>
      )}
    </Dialog>
  );
}
