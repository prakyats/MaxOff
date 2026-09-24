"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CalendarCheckIcon } from "lucide-react";
import { useState } from "react";

import { DataTable, type MobileCard } from "@/core/ui/composites/data-table";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/primitives/sheet";

import {
  canFlagOvertime,
  clockTime,
  describeEvent,
  describeHistoryDay,
  firstName,
  type HistoryDay,
  historyDate,
  SELF,
  type Viewpoint,
} from "../domain/history";

import { CorrectDayDialog, type CorrectTarget } from "./correct-day-dialog";
import { OvertimeDialog } from "./overtime-dialog";

/**
 * One person's attendance, one IST month (the month pager is the route's). A row says what the
 * day came to; opening it shows how, event by event: what they chose, what the Owner decided and
 * why, and what their leave changed. The member reads their own in their words (`SELF`, with
 * overtime on today's entry); the Owner reads someone else's in the same words turned around,
 * with **Correct** on every day (task 2.4, WORKFLOWS §1: any state, reason required).
 */
export function AttendanceHistory({
  days,
  monthName,
  today,
  viewpoint = SELF,
}: {
  days: HistoryDay[];
  /** "September 2026", for the empty state. */
  monthName: string;
  /** The IST date: today's entry carries the day's action (overtime). */
  today: string;
  viewpoint?: Viewpoint;
}) {
  // Desktop opens the same timeline in a side sheet; a phone uses DataTable's own sheet.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = days.find((day) => day.id === openId) ?? null;
  // Held here, above both sheets: choosing the action closes the phone's detail sheet.
  const [overtimeDayId, setOvertimeDayId] = useState<string | null>(null);
  const [correct, setCorrect] = useState<CorrectTarget | null>(null);
  const owner = viewpoint.kind === "owner" ? viewpoint : null;

  const dayAction = (day: HistoryDay, size: "sm" | "default") => {
    if (owner) {
      return (
        <Button
          variant="outline"
          size={size}
          onClick={() =>
            setCorrect({
              dayId: day.id,
              memberName: owner.name,
              workDate: day.workDate,
              current: day.finalStatus ?? day.submittedChoice,
              leaveType: leaveStatusOf(day),
            })
          }
        >
          Correct
        </Button>
      );
    }
    return canFlagOvertime(day, today) ? (
      <Button variant="outline" size={size} onClick={() => setOvertimeDayId(day.id)}>
        Flag overtime
      </Button>
    ) : null;
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
          className="focus-visible:ring-ring -mx-1 rounded px-1 font-medium whitespace-nowrap underline-offset-4 outline-none hover:underline focus-visible:ring-2"
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
      header: "Login · logout",
      enableSorting: false,
      cell: ({ row }) => <span className="text-muted-foreground">{times(row.original)}</span>,
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
      cell: ({ row }) => <div className="flex justify-end">{dayAction(row.original, "sm")}</div>,
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
    actions: (day) => dayAction(day, "default"),
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={days}
        getRowId={(day) => day.id}
        caption={owner ? `${owner.name}'s attendance` : "Your attendance"}
        pageSize={0}
        mobile={mobile}
        mobilePageSize={days.length || 1}
        emptyState={
          <EmptyState
            icon={CalendarCheckIcon}
            title={`Nothing recorded in ${monthName}`}
            description={
              owner
                ? `A day appears here once ${firstName(owner.name)} opens MaxOff on it.`
                : "A day appears here once you open MaxOff on it."
            }
          />
        }
      />
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
              {owner ? <div className="px-4">{dayAction(open, "default")}</div> : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>
      <OvertimeDialog
        dayId={overtimeDayId}
        onOpenChange={(next) => (next ? null : setOvertimeDayId(null))}
      />
      <CorrectDayDialog
        target={correct}
        onOpenChange={(next) => (next ? null : setCorrect(null))}
        onCorrected={() => setOpenId(null)}
      />
    </>
  );
}

function times(day: HistoryDay): string {
  const login = day.firstLoginAt ? clockTime(day.firstLoginAt) : "—";
  const logout = day.lastLogoutAt
    ? clockTime(day.lastLogoutAt)
    : day.logoutNotRecorded
      ? "not recorded"
      : "—";
  return `${login} · ${logout}`;
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
          <dt className="text-muted-foreground">Login · logout</dt>
          <dd className="text-right">{times(day)}</dd>
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
