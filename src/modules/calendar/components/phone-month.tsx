"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/core/lib/utils";
import { formatIST, istDayStart, type ISODate } from "@/core/time";

import type { CalendarDay } from "../domain/calendar";
import { dayLabel, dayStrips, type Strip } from "../domain/strips";
import { LEAVE_TONE, LeaveIcon } from "./calendar-chip";
import { StripLine } from "./month-grid";

/**
 * The phone's full month (the approved calendar sample's phone layout, the design gate of 23 Oct):
 * the month's days as two columns of boxes, each its weekday and date, then its chips at a width
 * that reads ("Edit · 11:45 am", "Test 4 · due 6:00 pm", "Shetty · Reel 1"), "+N more" and the
 * leave bar. A tap opens the day's popup, where every line is in full. The boxes scroll inside the
 * calendar (a vertical pan; a sideways swipe still moves the month), opening on the selected day.
 * Today: the red circle and the neutral tint, never an outline; the selected day the outlined box.
 */
export function PhoneMonth({
  dates,
  days,
  today,
  selected,
  onDay,
  className,
}: {
  dates: readonly ISODate[];
  days: ReadonlyMap<ISODate, CalendarDay>;
  today: ISODate;
  selected: ISODate | null;
  onDay: (date: ISODate) => void;
  className?: string | undefined;
}) {
  const list = useRef<HTMLOListElement>(null);
  const first = dates[0];
  // The selected day (else today) in view: on opening, and when another month is shown.
  useEffect(() => {
    const target = selected ?? today;
    list.current
      ?.querySelector(`[data-date="${target}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [first, selected, today]);
  return (
    <div
      data-slot="calendar-month"
      data-density="full"
      className={cn("flex min-h-0 min-w-0 flex-col", className)}
    >
      <ol
        ref={list}
        aria-label="Days"
        data-slot="calendar-month-days"
        className="grid min-h-0 flex-1 touch-pan-y grid-cols-2 content-start gap-1.5 overflow-y-auto overscroll-contain"
      >
        {dates.map((date) => {
          const day = days.get(date);
          const isToday = date === today;
          const isSelected = date === selected;
          const lines = day ? dayStrips(day, today) : null;
          const leave = lines?.strips.find((strip) => strip.kind === "leave") ?? null;
          const others = (lines?.strips ?? []).filter(
            (strip): strip is Exclude<Strip, { kind: "leave" }> => strip.kind !== "leave",
          );
          return (
            <li key={date} data-slot="calendar-cell" className="flex min-w-0">
              <button
                type="button"
                onClick={() => onDay(date)}
                data-slot="calendar-day"
                data-date={date}
                data-selected={isSelected ? "" : undefined}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={selected !== null ? isSelected : undefined}
                aria-label={
                  day ? dayLabel(day, today) : formatIST(istDayStart(date), "EEEE d MMMM")
                }
                className={cn(
                  "pressable focus-visible:ring-ring flex min-h-23 w-full min-w-0 flex-col items-stretch gap-1 rounded-lg border p-1.5 text-left outline-none select-none focus-visible:ring-2",
                  isSelected && !isToday ? "border-foreground" : "border-border",
                  isToday ? "bg-today" : day?.weeklyOff ? "bg-muted/50" : "bg-card",
                  "active:bg-muted/60",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    data-slot="calendar-date"
                    data-weekly-off={day?.weeklyOff ? "" : undefined}
                    data-holiday={lines?.holidayHidden ? "" : undefined}
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                      day?.weeklyOff && "text-muted-foreground",
                      lines?.holidayHidden && "text-holiday",
                      isToday && "bg-brand text-brand-foreground",
                    )}
                  >
                    {formatIST(istDayStart(date), "d")}
                  </span>
                  <span aria-hidden className="text-muted-foreground text-xs">
                    {formatIST(istDayStart(date), "EEE")}
                  </span>
                </span>
                <span aria-hidden className="flex min-h-0 min-w-0 flex-col gap-1">
                  {others.map((strip) => (
                    <StripLine key={strip.key} strip={strip} density="full" />
                  ))}
                  {lines?.more ? (
                    <span
                      data-slot="calendar-more"
                      className="text-muted-foreground block truncate px-1.5 text-xs leading-5 font-medium tabular-nums"
                    >
                      +{lines.more} more
                    </span>
                  ) : null}
                </span>
                {leave && leave.kind === "leave" ? (
                  <span
                    aria-hidden
                    data-slot="calendar-leave-bar"
                    data-pending={leave.pending ? "" : undefined}
                    className={cn(
                      LEAVE_TONE,
                      "mt-auto block truncate rounded-md px-1.5 text-xs leading-5 font-medium",
                      leave.pending && "border-leave/60 border border-dashed",
                    )}
                  >
                    <LeaveIcon className="mr-1 size-3" />
                    {leave.label}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
