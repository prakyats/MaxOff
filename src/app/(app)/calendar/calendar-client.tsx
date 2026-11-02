"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import { formatIST, istDayStart, systemClock, type ISODate } from "@/core/time";
import { CalendarScreen } from "@/modules/calendar/components/calendar-screen";
import { canStartTaskOnDate, NewTaskOnDayButton } from "@/modules/tasks/components/new-task-button";
import type { TaskFormSetup } from "@/modules/tasks/components/task-form-dialog";

/**
 * Crew's "Suggest a task on ‹day›" in its own chunk (v1.9 W5): rendered on the server like the rest
 * (in the first paint, nothing moves), but out of the calendar's first-load JS, which the Owner and
 * Admins (who never get it) share; the route's budget is never raised (ARCHITECTURE §19).
 */
const SuggestTaskButton = dynamic(() =>
  import("@/modules/tasks/components/suggest-task-button").then(
    (module) => module.SuggestTaskButton,
  ),
);

/**
 * The calendar with its day action (6.4b; Kickoff 6 decision 25 D), composed by the route from the
 * modules that own each part: the calendar draws the day; the task form and the suggestion are the
 * tasks module's. Whoever may create a task (`tasks.create`: the Owner and Admins) gets
 * "+ New task on Fri 30 Oct" (the deadline, or an event's date, on that day), and on a laptop with
 * a mouse the month's small "+" in a day's box for the same form (PP-calendar-13); Crew
 * (`task_requests.create`) get "Suggest a task on Fri 30 Oct" with the day in its details. Since
 * v1.9 W5 the action is also the pinned row at the foot of the laptop's Day and a phone's day
 * sheet, and neither shows on a day before today or on today from 11:59 pm IST.
 * The form's setup is a promise the page starts, read only when the form opens.
 */
export function CalendarClient({
  create,
  suggest,
  ...screen
}: Omit<ComponentProps<typeof CalendarScreen>, "dayAction" | "quickAdd"> & {
  create: Promise<TaskFormSetup | null> | null;
  suggest: readonly { id: string; name: string }[] | null;
}) {
  // A new task's deadline must be later than now (kickoff 4 decision 4): no "+ New task" on a day
  // with no valid deadline left, a day before today (IST) or today from 11:59 pm IST, where the
  // form could only refuse its own prefill. Crew's suggestion follows the same days (v1.9 W5).
  const open = (date: ISODate) => date >= screen.today && canStartTaskOnDate(date, systemClock());
  // "Fri 30 Oct": the day as its action names it (the approved v1.9 sample, W5).
  const words = (date: ISODate) => formatIST(istDayStart(date), "EEE d MMM");
  // `row`: the pinned row; `icon`: the laptop month's "+" in a day's box (PP-calendar-13).
  const newTask = (date: ISODate, row?: boolean, icon?: boolean) =>
    create && open(date) ? (
      <NewTaskOnDayButton
        setup={create}
        date={date}
        icon={icon}
        row={row}
        label={`New task on ${words(date)}`}
      />
    ) : null;
  const dayAction = create
    ? newTask
    : suggest
      ? (date: ISODate, row?: boolean) =>
          open(date) ? (
            <SuggestTaskButton
              clients={suggest}
              details={`For ${words(date)}.`}
              label={`Suggest a task on ${words(date)}`}
              row={row}
              className={row ? undefined : "max-w-full rounded-full"}
            />
          ) : null
      : null;
  return (
    <CalendarScreen
      {...screen}
      dayAction={dayAction}
      quickAdd={create ? (date: ISODate) => newTask(date, false, true) : null}
    />
  );
}
