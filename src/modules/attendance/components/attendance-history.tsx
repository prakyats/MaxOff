"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CalendarCheckIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { DataTable, type MobileCard } from "@/core/ui/composites/data-table";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { StatusDot } from "@/core/ui/composites/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/primitives/sheet";

import {
  clockTime,
  describeEvent,
  describeHistoryDay,
  type HistoryDay,
  historyDate,
} from "../domain/history";

/**
 * The member's own attendance, one IST month (the month pager is the route's). A row says what
 * the day came to; opening it shows how, event by event, in the member's words: what they
 * chose, what the Owner decided and why, and what their leave changed.
 */
export function AttendanceHistory({
  days,
  monthName,
}: {
  days: HistoryDay[];
  /** "September 2026", for the empty state. */
  monthName: string;
}) {
  // Desktop opens the same timeline in a side sheet; a phone uses DataTable's own sheet.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = days.find((day) => day.id === openId) ?? null;

  const columns = useMemo<ColumnDef<HistoryDay>[]>(
    () => [
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
          const summary = describeHistoryDay(row.original);
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
            {describeHistoryDay(row.original).flags.join(" · ")}
          </span>
        ),
      },
    ],
    [],
  );

  const mobile: MobileCard<HistoryDay> = {
    title: (day) => historyDate(day.workDate),
    subtitle: (day) => {
      const summary = describeHistoryDay(day);
      return [summary.standing, ...summary.flags].join(" · ");
    },
    trailing: (day) => {
      const summary = describeHistoryDay(day);
      return <StatusDot status={summary.dotStatus} label={summary.status} />;
    },
    detail: (day) => <DayTimeline day={day} />,
    detailTitle: (day) => historyDate(day.workDate),
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={days}
        getRowId={(day) => day.id}
        caption="Your attendance"
        pageSize={0}
        mobile={mobile}
        mobilePageSize={days.length || 1}
        emptyState={
          <EmptyState
            icon={CalendarCheckIcon}
            title={`Nothing recorded in ${monthName}`}
            description="A day appears here once you open MaxOff on it."
          />
        }
      />
      <Sheet open={open !== null} onOpenChange={(next) => (next ? null : setOpenId(null))}>
        <SheetContent side="right" data-slot="history-sheet" className="gap-4 overflow-y-auto">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle>{historyDate(open.workDate)}</SheetTitle>
                <SheetDescription>{describeHistoryDay(open).standing}</SheetDescription>
              </SheetHeader>
              <div className="px-4 text-sm">
                <DayTimeline day={open} />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
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

/** What a day came to, then how: every event in order, with the reason that came with it. */
function DayTimeline({ day }: { day: HistoryDay }) {
  const summary = describeHistoryDay(day);
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
            const line = describeEvent(event);
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
