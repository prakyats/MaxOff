import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireMember } from "@/core/auth/server";
import { startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import { getHoursToday, getOwnHours, getOwnToday, getTodayPeople } from "@/modules/attendance";
import { TaskTapSkeletonLazy } from "@/modules/tasks/components/task-tap-skeleton-lazy";

import { readDirectory, readOpenTasks } from "../tasks/reads";

import { AdminToday } from "./admin-today";
import { OwnerToday } from "./owner-today";
import { eventsHorizon, readEventTasks, readHolidays } from "./reads";

export const metadata: Metadata = { title: "Today" };

/**
 * Today: the Owner's (6.2) and the Admin's (6.3) home share this route (Kickoff 6 decisions 4–12).
 * The Owner's answers "who's in and what needs me" (counts → approvals → Needs you → the rest);
 * an Admin's starts with their own attendance strip, then the work they run. Crew's home is My Day
 * (6.1): a Crew member who types this address is taken there. Each screen updates live through
 * the bell's Realtime connection (`LiveUpdates`, decision 8).
 */
export default async function TodayPage() {
  // The Owner's board, an Admin's own day and the open tasks start with the session read, not
  // after it (§19): the role is not known yet, and what this viewer doesn't need is dropped. End
  // day's claim setup (read only after a Yes) starts with the render instead, so the first wave
  // stays within two of the Worker's six-at-a-time batches (v1.9 speed gate).
  const today = todayIST();
  startEarly(
    getTodayPeople(),
    getOwnToday(),
    // v1.9 W4: an Admin's own working hours (the strip), the Owner's everyone's (the Late line).
    getOwnHours(),
    getHoursToday(),
    readOpenTasks(),
    readDirectory(),
    readEventTasks(today, eventsHorizon(today)),
    readHolidays(today),
  );
  const viewer = await requireMember();
  // A task tapped before the router holds its loading screen still shows its skeleton (#143).
  const tap = <TaskTapSkeletonLazy manages={can(viewer.role, "tasks.create")} />;
  if (can(viewer.role, "attendance.view_all")) {
    return (
      <>
        {tap}
        <OwnerToday viewer={viewer} />
      </>
    );
  }
  if (can(viewer.role, "tasks.create")) {
    return (
      <>
        {tap}
        <AdminToday viewer={viewer} />
      </>
    );
  }
  redirect("/my-day");
}
