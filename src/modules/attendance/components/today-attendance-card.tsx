import Link from "next/link";

import { attendanceHref } from "@/core/auth/day-gate";
import { touchToday } from "@/core/auth/gate";
import { LogoutButton } from "@/core/auth/components";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/core/ui/primitives/card";
import { todayIST } from "@/core/time";

import { getOwnDay } from "../data/attendance";
import { dayLabel, describeToday } from "../domain/today";

import { OvertimeButton } from "./overtime-button";
import { WorkingTodayButton } from "./working-today-button";

/**
 * Today's attendance on the member's home: My Day for Staff, /today for Admins (both hold
 * `attendance.self`; the Owner has no day and no card). It says where the day stands, offers
 * "I'm working today" on a day of approved leave and the choice again when the day went back to
 * the gate, flags overtime, and carries **Log out** as a first-class action: logging out
 * records the time (WORKFLOWS §1), so it belongs here and not only behind a menu.
 */
export async function TodayAttendanceCard({
  memberId,
  home,
}: {
  memberId: string;
  /** Where the choice screen returns to. */
  home: string;
}) {
  const today = todayIST();
  // No row yet can mean the layout's touch is still opening today's day (layout and page
  // render in parallel): wait for that same call (`cache()`), then read again, past Next's
  // per-request memo of the first read. On the joining day there is still no row afterwards,
  // which is the right answer.
  let day = await getOwnDay(memberId, today);
  if (!day) {
    await touchToday();
    day = await getOwnDay(memberId, today, { fresh: true });
  }
  const view = describeToday(day);
  const dayOff = view.kind !== "not_started" && view.dayOff;

  return (
    <Card data-slot="attendance-card" className="mb-6" aria-labelledby="attendance-card-title">
      <CardHeader>
        <CardTitle id="attendance-card-title">Today&apos;s attendance</CardTitle>
        <CardDescription>
          {dayLabel(today)}
          {dayOff ? " · Day off" : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {view.kind === "not_started" ? (
          <p>Your attendance starts tomorrow. Welcome aboard.</p>
        ) : null}
        {view.kind === "choose" ? (
          <>
            <p>You haven&apos;t chosen today&apos;s attendance yet.</p>
            <Button asChild className="w-full md:w-auto md:self-start">
              <Link href={attendanceHref(home)}>Choose today&apos;s attendance</Link>
            </Button>
          </>
        ) : null}
        {view.kind === "on_leave" ? (
          <>
            <p data-slot="attendance-status" className="font-medium">
              {view.title}
            </p>
            <div className="md:self-start">
              <WorkingTodayButton label={view.workingLabel} forDate={today} />
            </div>
          </>
        ) : null}
        {view.kind === "status" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={view.state} />
              <p data-slot="attendance-status" className="font-medium">
                {view.title}
              </p>
            </div>
            {view.detail ? <p className="text-muted-foreground">{view.detail}</p> : null}
          </>
        ) : null}
        {day?.overtimeFlag ? (
          <p className="text-muted-foreground">
            Overtime flagged{day.overtimeReason ? `: ${day.overtimeReason}` : "."}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-col gap-2 md:flex-row md:justify-end">
        {day && !day.overtimeFlag ? <OvertimeButton dayId={day.id} /> : null}
        <div className="w-full md:w-auto [&>button]:w-full">
          <LogoutButton />
        </div>
      </CardFooter>
    </Card>
  );
}

/** The card's tracing for `loading.tsx` (ARCHITECTURE §14.1): title, date, status line, buttons. */
export function TodayAttendanceCardSkeleton() {
  return (
    <div
      data-slot="attendance-card-skeleton"
      aria-hidden
      className="bg-card ring-foreground/10 mb-6 flex flex-col gap-4 rounded-xl py-4 ring-1"
    >
      <div className="flex flex-col gap-1.5 px-4">
        <Skeleton className="h-5 w-40 rounded-md" />
        <Skeleton className="h-4 w-32 rounded-md" />
      </div>
      <div className="flex items-center gap-2 px-4">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-5 w-44 rounded-md" />
      </div>
      <div className="flex flex-col gap-2 px-4 md:flex-row md:justify-end">
        <Skeleton className="h-11 w-full rounded-md md:w-32" />
        <Skeleton className="h-11 w-full rounded-md md:w-28" />
      </div>
    </div>
  );
}
