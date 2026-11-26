"use client";

import { PlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
import type { ISODate } from "@/core/time";
import { Button } from "@/core/ui/primitives/button";

import { canStartTaskOnDate } from "../domain/start-on-date";
import { DAY_ROW_BUTTON } from "./day-row-button";
import type { TaskFormSetup } from "./task-form-dialog";

/**
 * Whether "+ New task" belongs on a calendar day: the day still has a deadline later than now
 * (a day before today never; today until 11:59 pm IST). The route asks before it draws the button,
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
 * "+ New task on Fri 30 Oct" in a calendar day (6.4b; Kickoff 6 decision 25 D; `tasks.create`):
 * the same form, the deadline (or an event's date) on that day. A pill-shaped trigger, neutral
 * solid as every trigger that opens a form; `row`, the pinned row at the foot of the laptop's Day
 * and a phone's day sheet (v1.9 W5), or, for the Owner and Admins since v6.0, the phone day's
 * pinned bar (`"bar"`, solid, the screen's one) and the laptop Day's Crew card (`"card"`, outlined). `icon`: the laptop month's small "+" in a day's box
 * (PP-calendar-13), the same form, its label spoken only.
 */
export function NewTaskOnDayButton({
  setup,
  date,
  label,
  icon,
  row,
  className,
}: {
  setup: Promise<TaskFormSetup | null>;
  date: ISODate;
  label: string;
  icon?: boolean | undefined;
  /** The pinned row (`true`); the phone day's solid bar or the Day's outlined card button (v6.0). */
  row?: boolean | "bar" | "card" | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={icon || row === "card" ? "secondary" : row === true ? "ghost" : "strong"}
        size={icon ? "icon-xs" : undefined}
        onClick={() => setOpen(true)}
        data-slot={icon ? "calendar-add-task" : "new-task-on-day"}
        data-date={date}
        data-row={row === true ? "" : undefined}
        data-look={row === "bar" || row === "card" ? row : undefined}
        aria-label={icon ? label : undefined}
        // Never wider than its row: at a very large text size the label ellipsises (the owner's
        // phone walk found "New task on 13 Nov" past a 375 px screen's edge at 200 %).
        className={cn(
          "max-w-full",
          row === true ? DAY_ROW_BUTTON : row ? "h-auto min-h-11 w-full" : "rounded-full",
          icon && "bg-card",
          className,
        )}
      >
        <PlusIcon aria-hidden />
        {icon ? null : <span className="min-w-0 truncate">{label}</span>}
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
