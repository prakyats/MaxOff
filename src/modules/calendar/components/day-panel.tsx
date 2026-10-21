"use client";

import type { ReactNode } from "react";

import type { ISODate } from "@/core/time";

import { type CalendarDay, type CalendarScope, dayHeading } from "../domain/calendar";
import { DayAgenda } from "./day-agenda";

/**
 * The laptop Month's selected-day panel (v1.8 L7, V5a): from `lg` up the selected day sits beside
 * the month instead of in a dialog over it. The same compact agenda as the day dialog (`DayAgenda`:
 * the events in time order, Due, the day's client work and, for the Owner and Admins only, the
 * availability line: "On leave", "Busy all day" or "Everyone is available"), its body the panel's
 * one scroll, and a footer with the day's buttons ("+ New task on 8 Oct" or "Suggest a task", and
 * "Open day"). Part of the screen, not a layer: nothing to close, no history (§14.2 d: a tap on a
 * day is view state and replaces the address).
 */
export function DayPanel({
  day,
  today,
  scope,
  free,
  action,
  footer,
}: {
  day: CalendarDay;
  today: ISODate;
  scope: CalendarScope;
  free: string | null;
  action: ReactNode;
  footer: ReactNode;
}) {
  const headingId = `calendar-day-panel-${day.date}`;
  return (
    <aside
      aria-labelledby={headingId}
      data-calendar="day-panel"
      data-layout="laptop"
      data-date={day.date}
      className="border-border bg-card hidden min-w-0 flex-col self-start rounded-lg border lg:flex"
    >
      <h2 id={headingId} aria-live="polite" className="px-4 pt-4 pb-3 text-base font-semibold">
        {dayHeading(day.date, today)}
      </h2>
      <div
        data-slot="calendar-day-body"
        className="max-h-[calc(100dvh-16rem)] min-h-0 overflow-y-auto px-4 pb-4"
      >
        <DayAgenda day={day} today={today} scope={scope} free={free} />
      </div>
      <div
        data-slot="calendar-day-footer"
        className="border-border flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-3"
      >
        {action}
        {footer}
      </div>
    </aside>
  );
}
