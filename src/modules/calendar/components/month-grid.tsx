"use client";

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
 * The month (6.4b; Kickoff 6 decision 25 A, B, C): Monday to Sunday, the neighbouring months'
 * days dimmed. Three densities: `compact` (the phone's opening size: the date and one thin bar per
 * kind, no text), `full` (the phone's full month: labelled strips, at most three then "+N") and
 * `laptop` (the same strips with the time and the client). Today's box is outlined; the weekly
 * off's date number is blue, never red; nothing is shaded; the due count sits in the corner. Text
 * is clipped inside its box, never past it. Every box is one button: what a tap does is the
 * caller's (select, or open the day).
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export type GridDensity = "compact" | "full" | "laptop";

/** A strip's look: the type's colour as a tint with a solid edge; grey for busy and leave. */
export function stripStyle(strip: Strip): { className: string; color?: string } {
  if (strip.kind === "event") {
    return {
      className: cn("border-l-2 text-foreground", strip.completed && "opacity-60 line-through"),
      color: strip.color,
    };
  }
  if (strip.kind === "holiday")
    return { className: "border-l-2 text-foreground", color: HOLIDAY_COLOR };
  if (strip.kind === "busy") {
    return { className: "border border-dotted border-muted-foreground/70 text-muted-foreground" };
  }
  return {
    className: cn(
      "bg-muted text-muted-foreground",
      strip.pending && "border border-dashed border-muted-foreground/70",
    ),
  };
}

function StripLine({ strip, density }: { strip: Strip; density: GridDensity }) {
  const look = stripStyle(strip);
  const text = density === "laptop" && strip.kind === "event" ? strip.long : strip.label;
  return (
    <div
      data-slot="calendar-strip"
      data-kind={strip.kind}
      className={cn(
        // Clipped, never ellipsised past its box (decision 25 C: text never overflows).
        "overflow-hidden rounded-sm px-1 whitespace-nowrap",
        density === "laptop" ? "text-xs leading-5" : "text-[0.625rem] leading-[0.875rem]",
        look.className,
      )}
      style={
        look.color ? { backgroundColor: `${look.color}26`, borderLeftColor: look.color } : undefined
      }
    >
      {text}
    </div>
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
  return (
    <div
      data-slot="calendar-month"
      data-density={density}
      className={cn("flex min-h-0 min-w-0 flex-col gap-1", className)}
    >
      <ol aria-hidden className="grid grid-cols-7 gap-1">
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
        className="grid min-h-0 flex-1 gap-1"
        style={{ gridTemplateRows: `repeat(${grid.weeks.length}, minmax(0, 1fr))` }}
      >
        {grid.weeks.map((week, row) => (
          <ol key={row} className="grid min-h-0 grid-cols-7 gap-1" aria-label={`Week ${row + 1}`}>
            {week.map((date) => {
              const day = days.get(date);
              const isToday = date === today;
              const isSelected = date === selected;
              const badge = day ? dueBadge(day, today) : null;
              const { strips, more } =
                day && density !== "compact" ? dayStrips(day) : { strips: [] as Strip[], more: 0 };
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
                      "pressable focus-visible:ring-ring relative flex w-full min-w-0 flex-col items-stretch gap-0.5 overflow-hidden rounded-md border p-0.5 text-left outline-none select-none focus-visible:ring-2",
                      density === "compact"
                        ? "min-h-11"
                        : density === "full"
                          ? "min-h-0"
                          : "min-h-28 p-1",
                      isToday ? "border-foreground" : "border-transparent",
                      !inMonth(date) && "opacity-45",
                      "active:bg-muted/60",
                    )}
                  >
                    <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-0.5">
                      <span
                        data-slot="calendar-date"
                        data-weekly-off={day?.weeklyOff ? "" : undefined}
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                          day?.weeklyOff && "text-off-day",
                          isSelected && "bg-foreground text-background",
                        )}
                      >
                        {formatIST(istDayStart(date), "d")}
                      </span>
                      {badge && density !== "compact" ? (
                        <span
                          data-slot="calendar-due-badge"
                          data-tone={badge.tone}
                          className={cn(
                            "overflow-hidden text-[0.625rem] leading-3 font-medium whitespace-nowrap tabular-nums",
                            badge.tone === "overdue" ? "text-danger" : "text-attention",
                          )}
                        >
                          {badge.label}
                        </span>
                      ) : null}
                      {badge && density === "compact" ? (
                        <span
                          aria-hidden
                          data-slot="calendar-due-dot"
                          data-tone={badge.tone}
                          className={cn(
                            "mr-0.5 size-1.5 shrink-0 rounded-full",
                            badge.tone === "overdue" ? "bg-danger" : "bg-attention",
                          )}
                        />
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
                                  : "bg-muted-foreground/50"),
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
                        {strips.map((strip) => (
                          <StripLine key={strip.key} strip={strip} density={density} />
                        ))}
                        {more > 0 ? (
                          <span
                            data-slot="calendar-more"
                            className="text-muted-foreground overflow-hidden px-1 text-[0.625rem] leading-3 whitespace-nowrap"
                          >
                            +{more}
                          </span>
                        ) : null}
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
