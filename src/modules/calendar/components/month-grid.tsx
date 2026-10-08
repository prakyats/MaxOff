"use client";

import { CircleAlertIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { formatIST, istDayStart, type ISODate } from "@/core/time";

import type { CalendarDay, MonthGrid as Grid } from "../domain/calendar";
import {
  compactBars,
  dayLabel,
  dayStrips,
  dueBadge,
  HOLIDAY_COLOR,
  type Strip,
} from "../domain/strips";

/**
 * The month (6.4b; Kickoff 6 decision 25 A, B, C, C amended 2026-10-08): Monday to Sunday, the
 * neighbouring months' days dimmed. Three densities: `compact` (the phone's opening size: the date,
 * a dot for due tasks, one thin bar per kind, no text), `full` (the phone's full month) and `laptop`
 * (the same lines, an event with its time and client). In a box, at most three lines then "+N":
 * the events, the tasks' count (amber "3 due"; a past day's overdue as a red pill with the count
 * and an icon on a phone, "1 overdue" on a laptop), the holiday (cut for space, the date number
 * turns green), others' busy, then leave as one thin low-contrast bar along the bottom, continuous
 * across consecutive leave days of the week row. Today's box is outlined; the weekly off's date
 * number is blue, never red; nothing is shaded. Every line is one line, ellipsised when it does not
 * fit, never clipped mid-word and never past its box (the owner's preview review). Every box is one
 * button: what a tap does is the caller's (select, or open the day).
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export type GridDensity = "compact" | "full" | "laptop";

const LINE = {
  full: "text-[0.625rem] leading-[0.875rem]",
  laptop: "text-xs leading-5",
} as const;

/** One line of a box: an event, the tasks' count, the holiday or someone busy. */
function StripLine({
  strip,
  density,
}: {
  strip: Exclude<Strip, { kind: "leave" }>;
  density: "full" | "laptop";
}) {
  if (strip.kind === "tasks") {
    if (strip.tone === "overdue" && density === "full") {
      // A past day's open tasks on a phone: a compact red pill, an icon and the count.
      return (
        <span
          data-slot="calendar-strip"
          data-kind="tasks"
          data-tone="overdue"
          className="bg-danger inline-flex w-fit max-w-full items-center gap-0.5 self-start rounded-full px-1 text-[0.625rem] leading-[0.875rem] font-semibold text-white tabular-nums"
        >
          <CircleAlertIcon className="size-2.5 shrink-0" aria-hidden />
          <span className="truncate">{strip.count}</span>
        </span>
      );
    }
    return (
      <span
        data-slot="calendar-strip"
        data-kind="tasks"
        data-tone={strip.tone}
        className={cn(
          "truncate px-1 font-medium tabular-nums",
          LINE[density],
          strip.tone === "overdue" ? "text-danger" : "text-attention",
        )}
      >
        {strip.label}
      </span>
    );
  }
  const text = density === "laptop" && strip.kind === "event" ? strip.long : strip.label;
  const color =
    strip.kind === "event" ? strip.color : strip.kind === "holiday" ? HOLIDAY_COLOR : null;
  return (
    <span
      data-slot="calendar-strip"
      data-kind={strip.kind}
      className={cn(
        // One line, ellipsised when it does not fit (decision 25 C; the owner's review).
        "block truncate rounded-sm px-1",
        LINE[density],
        color
          ? "text-foreground border-l-2"
          : "border-muted-foreground/70 text-muted-foreground border border-dotted",
        strip.kind === "event" && strip.completed && "line-through opacity-60",
      )}
      style={color ? { backgroundColor: `${color}26`, borderLeftColor: color } : undefined}
    >
      {text}
    </span>
  );
}

export function MonthGrid({
  grid,
  days,
  today,
  selected,
  density,
  onDay,
  className,
}: {
  grid: Grid;
  days: ReadonlyMap<ISODate, CalendarDay>;
  today: ISODate;
  /** The selected day (the phone's), marked; null where nothing is selected (the laptop). */
  selected: ISODate | null;
  density: GridDensity;
  onDay: (date: ISODate) => void;
  className?: string;
}) {
  const inMonth = (date: ISODate) => date.slice(0, 7) === grid.month.slice(0, 7);
  const linesOf = (date: ISODate | undefined) => {
    const day = date ? days.get(date) : undefined;
    return day && density !== "compact" ? dayStrips(day, today) : null;
  };
  return (
    <div
      data-slot="calendar-month"
      data-density={density}
      className={cn("flex min-h-0 min-w-0 flex-col gap-0.5", className)}
    >
      <ol aria-hidden className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((letter, index) => (
          <li
            key={index}
            className="text-muted-foreground text-center text-[0.6875rem] leading-4 uppercase"
          >
            {letter}
          </li>
        ))}
      </ol>
      <div
        className="grid min-h-0 flex-1 gap-0.5"
        style={{ gridTemplateRows: `repeat(${grid.weeks.length}, minmax(0, 1fr))` }}
      >
        {grid.weeks.map((week, row) => (
          <ol key={row} className="grid min-h-0 grid-cols-7 gap-0.5" aria-label={`Week ${row + 1}`}>
            {week.map((date, column) => {
              const day = days.get(date);
              const isToday = date === today;
              const isSelected = date === selected;
              const badge = day ? dueBadge(day, today) : null;
              const lines = linesOf(date);
              const leave = lines?.strips.find((strip) => strip.kind === "leave") ?? null;
              const others = (lines?.strips ?? []).filter(
                (strip): strip is Exclude<Strip, { kind: "leave" }> => strip.kind !== "leave",
              );
              // The leave bar joins the next and previous days' within the week row (Samsung).
              const leaveOf = (index: number) => {
                const other = linesOf(week[index]);
                return other?.strips.find((strip) => strip.kind === "leave") ?? null;
              };
              const before = column > 0 ? leaveOf(column - 1) : null;
              const after = column < 6 ? leaveOf(column + 1) : null;
              return (
                <li key={date} className="flex min-h-0 min-w-0">
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
                      "pressable focus-visible:ring-ring relative flex w-full min-w-0 flex-col items-stretch gap-px rounded-md border p-0.5 text-left outline-none select-none focus-visible:ring-2",
                      density === "compact"
                        ? "min-h-11 overflow-hidden"
                        : density === "full"
                          ? "min-h-0"
                          : "min-h-28 p-1",
                      // Each day its own faint tile (the owner's review): a hairline at low contrast, today strong.
                      isToday ? "border-foreground" : "border-border/60 bg-card/40",
                      !inMonth(date) && "opacity-45",
                      "active:bg-muted/60",
                    )}
                  >
                    {/* A container: the "+N" shows only where the box has room for it beside the
                        date (rem-sized, so a larger system text hides it on a narrow phone rather
                        than squeezing it to an ellipsis; the day's sheet lists everything). */}
                    <span className="@container flex min-w-0 items-center gap-0.5">
                      <span
                        data-slot="calendar-date"
                        data-weekly-off={day?.weeklyOff ? "" : undefined}
                        data-holiday={lines?.holidayHidden ? "" : undefined}
                        className={cn(
                          "flex shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                          density === "laptop" ? "size-6" : "size-5",
                          day?.weeklyOff && "text-off-day",
                          lines?.holidayHidden && "text-[#16a34a]",
                          isSelected && "bg-foreground text-background",
                        )}
                      >
                        {formatIST(istDayStart(date), "d")}
                      </span>
                      {badge && density === "compact" ? (
                        <span
                          aria-hidden
                          data-slot="calendar-due-dot"
                          data-tone={badge.tone}
                          className={cn(
                            "mr-0.5 ml-auto size-1.5 shrink-0 rounded-full",
                            badge.tone === "overdue" ? "bg-danger" : "bg-attention",
                          )}
                        />
                      ) : null}
                      {lines && lines.more > 0 ? (
                        <span
                          data-slot="calendar-more"
                          className="text-muted-foreground ml-auto hidden min-w-0 truncate text-[0.625rem] leading-3 tabular-nums @min-[2.25rem]:block"
                        >
                          +{lines.more}
                        </span>
                      ) : null}
                    </span>
                    {density === "compact" && day ? (
                      <span aria-hidden className="flex min-w-0 flex-col gap-0.5 px-0.5">
                        {compactBars(day).map((bar) => (
                          <span
                            key={bar.kind}
                            data-slot="calendar-bar"
                            data-kind={bar.kind}
                            className={cn(
                              "block h-0.5 w-full rounded-full",
                              bar.color === null &&
                                (bar.kind === "busy"
                                  ? "border-muted-foreground/70 h-0 border-t-2 border-dotted"
                                  : "bg-muted-foreground/40"),
                            )}
                            style={bar.color ? { backgroundColor: bar.color } : undefined}
                          />
                        ))}
                      </span>
                    ) : null}
                    {density !== "compact" ? (
                      <span
                        aria-hidden
                        className="flex min-h-0 min-w-0 flex-col gap-px overflow-hidden"
                      >
                        {others.map((strip) => (
                          <StripLine key={strip.key} strip={strip} density={density} />
                        ))}
                      </span>
                    ) : null}
                    {leave && leave.kind === "leave" && density !== "compact" ? (
                      <span
                        aria-hidden
                        data-slot="calendar-leave-bar"
                        data-pending={leave.pending ? "" : undefined}
                        className={cn(
                          // Low contrast, along the bottom, joined to its neighbours' bars.
                          "bg-muted text-muted-foreground mt-auto block truncate px-1",
                          density === "laptop"
                            ? "text-[0.6875rem] leading-4"
                            : "text-[0.5625rem] leading-3",
                          before
                            ? density === "laptop"
                              ? "-ml-[5px]"
                              : "-ml-[3px]"
                            : "rounded-l-sm",
                          after
                            ? density === "laptop"
                              ? "-mr-[7px]"
                              : "-mr-[5px]"
                            : "rounded-r-sm",
                          leave.pending && "border-muted-foreground/60 border-t border-dashed",
                        )}
                      >
                        {/* The name once per run of the same people; the rest of the run is the bar. */}
                        {before && before.kind === "leave" && before.label === leave.label
                          ? "\u00a0"
                          : leave.label}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        ))}
      </div>
    </div>
  );
}
