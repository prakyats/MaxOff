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
 * **The phone's sheet** (the approved calendar sample, the design gate of 23 Oct) is the day as a
 * list, no timeline: "Tasks · n" (every event and what is due, each a row with its chip), then
 * "Client work · n" by client, then who is away; its body scrolls when the day is full, and the
 * day's buttons sit under it side by side, "Open day" (the day under the week strip) and the one
 * solid "+ New task on 8 Oct" (or "Suggest a task"). **The laptop's dialog** (the owner's
 * 2026-10-08 changes) has no timeline either: a compact agenda (`DayAgenda`) whose body is the
 * dialog's one scroll, used only when the day is very full, and a footer pinned under it with the
 * same buttons.
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
              {/* The sample's order: "Open day", then the day's own action at the end. */}
              {footer}
              {action}
            </div>
          ) : null}
        </DialogContent>
      ) : (
        // One column no wider than the sheet (the surface is a grid; a one-line row's min-content
        // must not widen it past the screen at large text).
        <DialogContent
          className="grid-cols-[minmax(0,1fr)] md:max-w-lg"
          data-calendar="day-sheet"
          data-date={day.date}
        >
          <DialogHeader>
            <DialogTitle>{dayHeading(day.date, today)}</DialogTitle>
            <DialogDescription className="sr-only">
              What is on this day, and what you can do on it.
            </DialogDescription>
          </DialogHeader>
          <div data-slot="calendar-day-body" className="max-h-[60svh] min-w-0 overflow-y-auto">
            <DayDetail
              day={day}
              today={today}
              scope={scope}
              free={free}
              action={null}
              timeline={false}
              heading={false}
              headingId={`sheet-${day.date}`}
            />
          </div>
          {action || footer ? (
            <div
              data-slot="calendar-day-footer"
              className="border-border -mx-4 flex min-w-0 items-center gap-2 border-t px-4 pt-3 *:min-w-0 *:flex-1"
            >
              {/* The sample's order: "Open day", then the day's one solid action. */}
              {footer}
              {action}
            </div>
          ) : null}
        </DialogContent>
      )}
    </Dialog>
  );
}
