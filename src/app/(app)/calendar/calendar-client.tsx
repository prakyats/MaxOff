"use client";

import type { ComponentProps } from "react";

import { formatIST, istDayStart, type ISODate } from "@/core/time";
import { CalendarScreen } from "@/modules/calendar/components/calendar-screen";
import { NewTaskOnDayButton } from "@/modules/tasks/components/new-task-button";
import { SuggestTaskButton } from "@/modules/tasks/components/suggest-task-button";
import type { TaskFormSetup } from "@/modules/tasks/components/task-form-dialog";

/**
 * The calendar with its day action (6.4b; Kickoff 6 decision 25 D), composed by the route from the
 * modules that own each part: the calendar draws the day; the task form and the suggestion are the
 * tasks module's. Whoever may create a task (`tasks.create`: the Owner and Admins) gets
 * "+ New task on 8 Oct" (the deadline, or an event's date, on that day); Crew
 * (`task_requests.create`) get "Suggest a task" with the day in its details. The form's setup is a
 * promise the page starts, read only when the form opens.
 */
export function CalendarClient({
  create,
  suggest,
  ...screen
}: Omit<ComponentProps<typeof CalendarScreen>, "dayAction"> & {
  create: Promise<TaskFormSetup | null> | null;
  suggest: readonly { id: string; name: string }[] | null;
}) {
  const dayAction = create
    ? (date: ISODate) => (
        <NewTaskOnDayButton
          setup={create}
          date={date}
          label={`New task on ${formatIST(istDayStart(date), "d MMM")}`}
        />
      )
    : suggest
      ? (date: ISODate) => (
          <SuggestTaskButton
            clients={suggest}
            details={`For ${formatIST(istDayStart(date), "EEE d MMM")}.`}
            className="rounded-full"
          />
        )
      : null;
  return <CalendarScreen {...screen} dayAction={dayAction} />;
}
