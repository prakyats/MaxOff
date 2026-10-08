"use client";

import { PlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
import type { ISODate } from "@/core/time";
import { Button } from "@/core/ui/primitives/button";

import { canStartTaskOnDate } from "../domain/form";
import type { TaskFormSetup } from "./task-form-dialog";

/**
 * Whether "+ New task" belongs on a calendar day: the day still has a deadline later than now
 * (a day before today never; today until 11:59 PM IST). The route asks before it draws the button,
 * so a day without one shows no action at all.
 */
export { canStartTaskOnDate };

/** The form (selects, the warning check, custom fields) loads when it first opens (§19). */
const TaskFormDialog = dynamic(
  () => import("./task-form-dialog").then((module) => module.TaskFormDialog),
  { ssr: false },
);

const CREATE = { kind: "create" } as const;

/**
 * "+ New task on 8 Oct" in a calendar day's detail (6.4b; Kickoff 6 decision 25 D; `tasks.create`):
 * the same form, the deadline (or an event's date) on that day. A pill-shaped trigger, neutral
 * solid as every trigger that opens a form.
 */
export function NewTaskOnDayButton({
  setup,
  date,
  label,
  className,
}: {
  setup: Promise<TaskFormSetup | null>;
  date: ISODate;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="strong"
        onClick={() => setOpen(true)}
        data-slot="new-task-on-day"
        data-date={date}
        className={cn("rounded-full", className)}
      >
        <PlusIcon aria-hidden />
        {label}
      </Button>
      {open ? (
        <TaskFormDialog
          setup={setup}
          mode={{ kind: "create", date }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * "New task" for the Owner and Admins (`tasks.create`, 4.3): the Tasks screen's one action, a FAB
 * on a phone through `PageHeader` (§14.1). A trigger that opens a form, so neutral solid (the
 * action colour rule); the commit is inside. `setup` is read only when the form opens.
 */
export function NewTaskButton({ setup }: { setup: Promise<TaskFormSetup | null> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="strong" onClick={() => setOpen(true)} data-slot="new-task">
        <PlusIcon aria-hidden />
        New task
      </Button>
      {open ? <TaskFormDialog setup={setup} mode={CREATE} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
