"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CalendarCheckIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
import { DataTable, type MobileCard } from "@/core/ui/composites/data-table";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { useAction } from "@/core/ui/action/use-action";
import { Button } from "@/core/ui/primitives/button";
import { displayName } from "@/core/lib/display-name";
import { toastResult } from "@/core/ui/toast";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/primitives/sheet";

import { approveDay } from "../actions/review";
import {
  approveDayLabel,
  clockTime,
  dayTimesLine,
  describeEvent,
  describeHistoryDay,
  type HistoryDay,
  historyDate,
  SELF,
  type Viewpoint,
} from "../domain/history";

import { canAddNote, type NoteDay } from "../domain/notes";

import { CorrectDayDialog, type CorrectTarget } from "./correct-day-dialog";
import { ExtraWorkNoteDialog } from "./extra-work-note-dialog";

/**
 * One person's attendance, one IST month (the month pager is the route's). A row says what the
 * day came to; opening it shows how, event by event: what they chose, what the Owner decided and
 * why, and what their leave changed. The member reads their own in their words (`SELF`, with
 * **Add note** on the last 7 days: an overtime note, or "I worked that day" on a day off, 3b.2);
 * the Owner reads someone else's in the same words turned around. **Every row opens its day**
 * (the approved pull-in sample, V5b-D): the Owner's actions are in the day's sheet, **Correct** on
 * any day (task 2.4, WORKFLOWS §1: any state, reason required) and, on a day waiting for them,
 * **Approve** (Forest) beside it, the same `attendance_decide()` Approvals uses; the waiting row
 * alone carries Approve too, so no row has a Correct button. Empty times read "Not recorded".
 * One note under the table says how a day is put right.
 */
export function AttendanceHistory({
  days,
  monthName,
  today,
  viewpoint = SELF,
  noteDays = [],
}: {
  days: HistoryDay[];
  /** "September 2026", for the empty state. */
  monthName: string;
  /** The IST date: the last 7 days carry the extra work note. */
  today: string;
  viewpoint?: Viewpoint;
  /** The days a note may be about (`noteDays()`), for the member's own history. */
  noteDays?: NoteDay[];
}) {
  // Desktop opens the same timeline in a side sheet; a phone uses DataTable's own sheet.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = days.find((day) => day.id === openId) ?? null;
  // Held here, above both sheets: choosing the action closes the phone's detail sheet.
  const [noteDate, setNoteDate] = useState<string | null>(null);
  const [correct, setCorrect] = useState<CorrectTarget | null>(null);
  const owner = viewpoint.kind === "owner" ? viewpoint : null;

  const approve = useAction(async (day: HistoryDay) => {
    const result = await approveDay({ dayId: day.id });
    toastResult(result, {
      success: `Approved ${owner ? `${displayName(owner.name)}'s` : "the"} ${historyDate(day.workDate)}`,
    });
    if (result.ok) setOpenId(null);
  });

  const correctDay = (day: HistoryDay) => {
    if (!owner) return;
    setCorrect({
      dayId: day.id,
      memberName: owner.name,
      workDate: day.workDate,
      current: day.finalStatus ?? day.submittedChoice,
      leaveType: leaveStatusOf(day),
      compDays: owner.compDays ?? null,
    });
  };

  /** The member's own row action: Add note on the last 7 days (3b.2). */
  const noteAction = (day: HistoryDay, size: "sm" | "default") => {
    if (owner) return null;
    if (!canAddNote(day.workDate, today) || !noteDays.some((d) => d.date === day.workDate)) {
      return null;
    }
    return (
      <Button
        variant="secondary"
        size={size}
        onClick={(event) => {
          // On the laptop row, which opens the day: the note's dialog alone.
          event.stopPropagation();
          setNoteDate(day.workDate);
        }}
      >
        {day.isDayOff ? "I worked that day" : "Add overtime note"}
      </Button>
    );
  };

  /** The day sheet's actions: the Owner's Approve (a waiting day) and Correct; the member's note. */
  const sheetActions = (day: HistoryDay) => {
    if (!owner) return noteAction(day, "default");
    const approveLabel = approveDayLabel(day);
    return (
      <>
        {approveLabel ? (
          <Button
            variant="approve"
            commits
            data-slot="history-approve"
            disabled={approve.pending}
            onClick={() => approve.run(day)}
          >
            {approveLabel}
          </Button>
        ) : null}
        <Button variant="secondary" data-slot="history-correct" onClick={() => correctDay(day)}>
          Correct this day…
        </Button>
      </>
    );
  };

  const columns: ColumnDef<HistoryDay>[] = [
    {
      id: "date",
      header: "Date",
      enableSorting: false,
      size: 140,
      // A real button, so the day opens from the keyboard too.
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => setOpenId(row.original.id)}
          className="pressable-row focus-visible:ring-ring -mx-1 rounded px-1 font-medium whitespace-nowrap underline-offset-4 outline-none hover:underline focus-visible:ring-2"
        >
          {historyDate(row.original.workDate)}
        </button>
      ),
    },
    {
      id: "status",
      header: "Attendance",
      enableSorting: false,
      cell: ({ row }) => {
        const summary = describeHistoryDay(row.original, viewpoint);
        return (
          <div className="flex flex-col gap-0.5">
            <StatusDot status={summary.dotStatus} label={summary.status} className="text-sm" />
            <span className="text-muted-foreground text-xs">{summary.standing}</span>
          </div>
        );
      },
    },
    {
      id: "times",
      header: "Start · end",
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className={cn(
            "whitespace-nowrap",
            !row.original.startedAt && !row.original.endedAt && "text-muted-foreground",
          )}
          data-slot="history-times"
        >
          {dayTimesLine(row.original)}
        </span>
      ),
    },
    {
      id: "flags",
      header: "Notes",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {describeHistoryDay(row.original, viewpoint).flags.join(" · ")}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => {
        const day = row.original;
        if (!owner) return <div className="flex justify-end">{noteAction(day, "sm")}</div>;
        return (
          <div className="flex items-center justify-end gap-2">
            {/* Only a waiting day carries a button: Approve, as in Approvals (V5b-D). */}
            {approveDayLabel(day) ? (
              <Button
                variant="approve"
                size="sm"
                commits
                data-slot="history-row-approve"
                disabled={approve.pending}
                onClick={(event) => {
                  event.stopPropagation();
                  approve.run(day);
                }}
              >
                Approve
              </Button>
            ) : null}
            <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          </div>
        );
      },
    },
  ];

  const mobile: MobileCard<HistoryDay> = {
    title: (day) => historyDate(day.workDate),
    subtitle: (day) => {
      const summary = describeHistoryDay(day, viewpoint);
      return [summary.standing, ...summary.flags].join(" · ");
    },
    trailing: (day) => {
      const summary = describeHistoryDay(day, viewpoint);
      return <StatusDot status={summary.dotStatus} label={summary.status} />;
    },
    detail: (day) => <DayTimeline day={day} viewpoint={viewpoint} />,
    detailTitle: (day) => historyDate(day.workDate),
    actions: (day) => sheetActions(day),
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={days}
        getRowId={(day) => day.id}
        caption={owner ? `${owner.name}'s attendance` : "Your attendance"}
        pageSize={0}
        onRowClick={(row) => setOpenId(row.original.id)}
        mobile={mobile}
        mobilePageSize={days.length || 1}
        emptyState={
          <EmptyState
            icon={CalendarCheckIcon}
            title={`Nothing recorded in ${monthName}`}
            description={
              owner
                ? `A day appears here once ${displayName(owner.name)} opens MaxOff on it.`
                : "A day appears here once you open MaxOff on it."
            }
          />
        }
      />
      {days.length > 0 ? (
        // Once, under the table (V5b-D): how a day is put right.
        <p data-slot="history-note" className="text-muted-foreground mt-3 text-xs">
          {owner
            ? "Tap a day to correct it. Corrections sit beside the original; history is never overwritten."
            : "Something wrong with a day? Ask the Owner to correct it. Corrections sit beside the original; history is never overwritten."}
        </p>
      ) : null}
      <Sheet open={open !== null} onOpenChange={(next) => (next ? null : setOpenId(null))}>
        <SheetContent side="right" data-slot="history-sheet" className="gap-4 overflow-y-auto">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle>{historyDate(open.workDate)}</SheetTitle>
                <SheetDescription>{describeHistoryDay(open, viewpoint).standing}</SheetDescription>
              </SheetHeader>
              <div className="px-4 text-sm">
                <DayTimeline day={open} viewpoint={viewpoint} />
              </div>
              {owner ? (
                <div className="flex flex-col gap-2 px-4" data-slot="history-sheet-actions">
                  {sheetActions(open)}
                </div>
              ) : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>
      {noteDate ? (
        <ExtraWorkNoteDialog
          days={noteDays}
          initialDate={noteDate}
          onClose={() => setNoteDate(null)}
        />
      ) : null}
      <CorrectDayDialog
        target={correct}
        onOpenChange={(next) => (next ? null : setCorrect(null))}
        onCorrected={() => setOpenId(null)}
      />
    </>
  );
}

/** The day's leave status, when it is one: correcting to another leave type keeps that leave. */
function leaveStatusOf(day: HistoryDay): CorrectTarget["leaveType"] {
  const status = day.finalStatus;
  return status === "leave" || status === "half_day" || status === "comp_leave" ? status : null;
}

/** What a day came to, then how: every event in order, with the reason that came with it. */
function DayTimeline({ day, viewpoint }: { day: HistoryDay; viewpoint: Viewpoint }) {
  const summary = describeHistoryDay(day, viewpoint);
  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-3">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Attendance</dt>
          <dd className="text-right">
            <StatusDot status={summary.dotStatus} label={summary.status} className="text-sm" />
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Start · end</dt>
          <dd className="text-right">{dayTimesLine(day)}</dd>
        </div>
        {summary.flags.length > 0 ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="text-right">{summary.flags.join(" · ")}</dd>
          </div>
        ) : null}
      </dl>
      {day.events.length > 0 ? (
        <ol data-slot="day-timeline" className="border-border flex flex-col gap-3 border-l pl-4">
          {day.events.map((event) => {
            const line = describeEvent(event, viewpoint);
            return (
              <li key={event.id} data-slot="day-event" className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs">{clockTime(event.at)}</span>
                <span>{line.text}</span>
                {line.note ? (
                  <span className="text-muted-foreground break-words">{line.note}</span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
