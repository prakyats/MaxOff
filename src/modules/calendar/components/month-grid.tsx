"use client";

import type { ReactNode } from "react";

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
import {
  DoneTick,
  DUE_TONE,
  DueIcon,
  ItemIcon,
  LEAVE_TONE,
  LeaveIcon,
  TypeDot,
  typeTint,
} from "./calendar-chip";
import { LEAVE_FIT_LABEL } from "./leave-fit";

/**
 * The month (6.4b; Kickoff 6 decision 25 A, B, C, C amended 2026-10-08): Monday to Sunday, the
 * neighbouring months' days dimmed. Three densities: `compact` (the phone's opening size: the date,
 * a dot for due tasks, one thin bar per kind, no text), `full` (the phone's full month) and `laptop`
 * (the same lines, an event with its title then its time and client). In a box, at most three
 * lines, the last "+N more" when there are more (PP-calendar-14): the events, what is due by name
 * (amber, red overdue with its icon), the holiday (cut for space, the date number turns green),
 * others' busy, then leave as a soft neutral striped bar along the bottom, "Asha · On leave" with the palm icon, continuous across consecutive leave days
 * of the week row (`calendar-chip`: the day's dialog draws the same chips). V5b's polish
 * (PP-calendar-1, 4, 6, 7): today's date number is a filled red circle on a neutral tint, never
 * outlined, and any other selected day the outlined box; the weekly off's date number is muted grey and its box lightly tinted; the
 * weekdays read "Mon Tue …" on a laptop, single letters on a phone; done is dimmed with a ✓. Every
 * line is one line at a fixed height, ellipsised when it does not fit, never wrapped, clipped
 * mid-word or past its box (the owner's preview review; SCOPE §6). Client deliverables are outlined
 * chips with the client first, after the tasks (the approved calendar sample). Every box is one button: what a tap does is the caller's (select, or
 * open the day).
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const WEEKDAYS_LAPTOP = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type GridDensity = "compact" | "full" | "laptop";

const LINE = {
  full: "text-xs leading-4",
  laptop: "text-xs leading-5",
} as const;

/**
 * One chip of a box: an event, a thing due, a client deliverable, the holiday or someone busy.
 * One line at a fixed height, ellipsised, everywhere (SCOPE §6, "One line, always"): the day's
 * popup or sheet shows the full text.
 */
function StripLine({
  strip,
  density,
}: {
  strip: Exclude<Strip, { kind: "leave" }>;
  density: "full" | "laptop";
}) {
  const fit = "truncate";
  if (strip.kind === "item") {
    // The approved calendar sample: an outlined chip, the box icon, the client first; red
    // outlined when late, and it says so (never colour alone).
    return (
      <span
        data-slot="calendar-strip"
        data-kind="item"
        data-late={strip.late ? "" : undefined}
        className={cn(
          "block rounded-sm border px-1",
          LINE[density],
          fit,
          strip.late ? "border-danger text-danger" : "border-border text-foreground",
        )}
      >
        <ItemIcon className="mr-0.5 size-2.5" />
        {/* An inline block cut on its own, so a long client never reaches past the box: narrower
            than the line by the icon and the box's own "…" (an atomic block reaching into the
            ellipsis's room would be hidden whole, leaving "…" alone on a phone). */}
        <span className="inline-block max-w-[calc(100%-1.5rem)] truncate align-top font-semibold">
          {strip.client}
        </span>{" "}
        · {strip.title}
        {strip.late ? " · late" : ""}
      </span>
    );
  }
  if (strip.kind === "due") {
    // PP-calendar-5 and the approved sample: named, a filled soft chip in amber (red and its alert
    // icon when overdue), the type's colour as the leading dot (major change 5: no side stripe).
    return (
      <span
        data-slot="calendar-strip"
        data-kind="due"
        data-tone={strip.tone}
        className={cn(
          "block rounded-sm px-1 font-medium",
          LINE[density],
          fit,
          DUE_TONE[strip.tone],
        )}
      >
        {strip.color ? <TypeDot color={strip.color} className="mr-1" /> : null}
        {strip.tone === "overdue" ? <DueIcon tone="overdue" className="mr-0.5 size-2.5" /> : null}
        {strip.label}
      </span>
    );
  }
  const text = density === "laptop" && strip.kind === "event" ? strip.long : strip.label;
  const color =
    strip.kind === "event" ? strip.color : strip.kind === "holiday" ? HOLIDAY_COLOR : null;
  const done = strip.kind === "event" && strip.completed;
  return (
    <span
      data-slot="calendar-strip"
      data-kind={strip.kind}
      data-completed={done ? "" : undefined}
      className={cn(
        // One line, ellipsised when it does not fit (decision 25 C; the owner's review).
        "block rounded-sm px-1",
        LINE[density],
        fit,
        // A task (and the holiday) is a filled soft chip with its dot (the approved sample, no
        // side stripe); someone busy is grey and dotted.
        color
          ? "text-foreground"
          : "border-muted-foreground/70 text-muted-foreground border border-dotted",
        // PP-calendar-7: done is dimmed with a ✓, never struck through.
        done && "opacity-60",
      )}
      style={color ? typeTint(color) : undefined}
    >
      {done ? (
        <DoneTick className="mr-0.5 size-2.5" />
      ) : color ? (
        <TypeDot color={color} className="mr-1" />
      ) : null}
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
  add,
  className,
}: {
  grid: Grid;
  days: ReadonlyMap<ISODate, CalendarDay>;
  today: ISODate;
  /** The selected day (the phone's), marked; null where nothing is selected (the laptop). */
  selected: ISODate | null;
  density: GridDensity;
  onDay: (date: ISODate) => void;
  /**
   * A day's "+" (PP-calendar-13, the laptop's: New task on it), beside the box, never inside its
   * button: shown with a mouse or trackpad only, while the pointer is on the box's empty part or
   * the "+" has focus (`calendar-add`, globals.css).
   */
  add?: ((date: ISODate) => ReactNode) | null;
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
        {(density === "laptop" ? WEEKDAYS_LAPTOP : WEEKDAYS).map((name, index) => (
          <li
            key={index}
            className={cn(
              "text-muted-foreground text-center text-xs leading-4",
              density !== "laptop" && "uppercase",
            )}
          >
            {name}
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
              const plus = add?.(date);
              return (
                <li key={date} data-slot="calendar-cell" className="relative flex min-h-0 min-w-0">
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
                      // Each day its own faint tile (the owner's review): a hairline at low
                      // contrast; only the selected day outlined (PP-calendar-1, PP-phone-3: the
                      // outline follows the tapped day); the weekly off lightly tinted
                      // (PP-calendar-4); today's box a neutral tint, one surface step up, with no
                      // shadow that could read as a second outline (PP-calendar-15, FINAL 4).
                      // Today is marked by its red circle and its tint alone: never also the
                      // selection's outline (the design gate, 23 Oct; kept on the phone by the
                      // owner's correction of 23 Oct).
                      isSelected && !isToday ? "border-foreground" : "border-border/60",
                      isToday ? "bg-today" : day?.weeklyOff ? "bg-muted/50" : "bg-card/40",
                      !inMonth(date) && "opacity-45",
                      "active:bg-muted/60",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-0.5">
                      <span
                        data-slot="calendar-date"
                        data-weekly-off={day?.weeklyOff ? "" : undefined}
                        data-holiday={lines?.holidayHidden ? "" : undefined}
                        className={cn(
                          "flex shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                          density === "laptop" ? "size-6" : "size-5",
                          day?.weeklyOff && "text-muted-foreground",
                          lines?.holidayHidden && "text-holiday",
                          // PP-calendar-1: today is the filled red circle.
                          isToday && "bg-brand text-brand-foreground",
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
                        className="@container flex min-h-0 min-w-0 flex-col gap-px overflow-hidden"
                      >
                        {others.map((strip) => (
                          <StripLine key={strip.key} strip={strip} density={density} />
                        ))}
                        {/* PP-calendar-14: what does not fit is one last line, "+N more" ("+N" where
                            the box is too narrow for the word), part of the box: a tap opens the day. */}
                        {lines?.more ? (
                          <span
                            data-slot="calendar-more"
                            className={cn(
                              "text-muted-foreground block truncate px-1 font-medium tabular-nums",
                              LINE[density],
                            )}
                          >
                            +{lines.more}
                            <span className="hidden @min-[3.5rem]:inline"> more</span>
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    {leave && leave.kind === "leave" && density !== "compact" ? (
                      <span
                        aria-hidden
                        data-slot="calendar-leave-bar"
                        data-leave-fit={density === "laptop" ? "long" : undefined}
                        data-pending={leave.pending ? "" : undefined}
                        className={cn(
                          // Along the bottom, joined to its neighbours' bars, soft neutral with faint
                          // stripes (PP-calendar-3, 10), so a leave run reads at a glance.
                          LEAVE_TONE,
                          "mt-auto block px-1 font-medium",
                          // The laptop's bar never truncates: "Name · On leave", or "Name ·
                          // Leave" where that has no room (v1.8, owner 23 Oct; `useLeaveFit`).
                          density === "laptop" ? LEAVE_FIT_LABEL : "truncate",
                          "text-xs leading-4",
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
                          leave.pending && "border-leave/60 border-t border-dashed",
                        )}
                      >
                        {/* The name once per run of the same people; the rest of the run is the bar. */}
                        {before && before.kind === "leave" && before.label === leave.label ? (
                          "\u00a0"
                        ) : (
                          <>
                            <LeaveIcon className="mr-0.5 size-2.5" />
                            {density === "laptop" ? (
                              <>
                                <span data-leave-word="long">{leave.label}</span>
                                <span data-leave-word="short">{leave.short}</span>
                              </>
                            ) : (
                              leave.label
                            )}
                          </>
                        )}
                      </span>
                    ) : null}
                  </button>
                  {plus ? (
                    <span data-slot="calendar-add" className="absolute top-[5px] right-[5px]">
                      {plus}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ))}
      </div>
    </div>
  );
}
