"use client";

import { MoreHorizontalIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import { toastResult } from "@/core/ui/toast";

import { cancelTask, reopenTask } from "../actions/tasks";
import type { MoreStep } from "../domain/page";
import type { TaskActions } from "../domain/task";
import type { AdminOption, Task, TaskAssignee } from "../domain/types";

import type { TaskFormSetup } from "./task-form-dialog";
import { useTaskView } from "./task-view";

const TaskFormDialog = dynamic(
  () => import("./task-form-dialog").then((module) => module.TaskFormDialog),
  { ssr: false },
);

/** The approver sheet's code (a select) loads when it first opens (4B review S12). */
const ApproverDialog = dynamic(
  () => import("./task-approver-dialog").then((module) => module.ApproverDialog),
  { ssr: false },
);

type Open = "edit" | "approver" | "cancel" | "reopen" | null;

/**
 * The task page's ⋯ (4.4; PERMISSIONS §3; Kickoff 4 decision 26: "everything else under ⋯"):
 * the viewer's other work beside the next step (Mark done while Start work is the step; the
 * Owner's "Decide it yourself" at a waiting Admin step), then Edit, Change approver (the Owner),
 * Cancel and Reopen for the task's creator, its approving Admin and the Owner. Occasional actions,
 * one tap deeper than the next step (PRODUCT §2). A layer like every menu (§14.2 a); each item
 * hands off to its own dialog (the work's live beside the next step, `TaskNextStep`).
 */
export function TaskMenu({
  task,
  assignees,
  clientName,
  setup,
  admins,
  manage,
  changeApprover,
  more,
  doneLabel,
}: {
  task: Task;
  assignees: TaskAssignee[];
  clientName: string | null;
  setup: Promise<TaskFormSetup | null> | null;
  admins: AdminOption[];
  manage: TaskActions["manage"];
  changeApprover: boolean;
  more: MoreStep[];
  /** "Mark done", "Mark done again", "Mark done for Asha". */
  doneLabel: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const { setDialog } = useTaskView();
  const managing = manage.edit || manage.cancel || manage.reopen || changeApprover;
  if (!managing && more.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Task actions"
            data-slot="task-menu"
            className="size-11 md:size-8"
          >
            <MoreHorizontalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {more.includes("done") ? (
            <DropdownMenuItem onSelect={() => setDialog("done")}>{doneLabel}</DropdownMenuItem>
          ) : null}
          {more.includes("takeOver") ? (
            <DropdownMenuItem onSelect={() => setDialog("takeOver")}>
              Decide it yourself
            </DropdownMenuItem>
          ) : null}
          {more.length > 0 && managing ? <DropdownMenuSeparator /> : null}
          {manage.edit && setup ? (
            <DropdownMenuItem onSelect={() => setOpen("edit")}>Edit task</DropdownMenuItem>
          ) : null}
          {changeApprover ? (
            <DropdownMenuItem onSelect={() => setOpen("approver")}>
              Change approver
            </DropdownMenuItem>
          ) : null}
          {manage.reopen ? (
            <DropdownMenuItem onSelect={() => setOpen("reopen")}>Reopen task</DropdownMenuItem>
          ) : null}
          {manage.cancel ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setOpen("cancel")}>
                Cancel task
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {open === "edit" && setup ? (
        <TaskFormDialog
          setup={setup}
          mode={{ kind: "edit", task, assignees, clientName }}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === "approver" ? (
        <ApproverDialog
          taskId={task.id}
          current={task.approvingAdminId}
          admins={admins}
          onClose={() => setOpen(null)}
        />
      ) : null}
      <ReasonDialog
        open={open === "cancel"}
        onOpenChange={(next) => setOpen(next ? "cancel" : null)}
        title="Cancel this task?"
        description="It stops here and stays in the history and the reports. Everyone on it sees the reason."
        submitLabel="Cancel task"
        cancelLabel="Keep it"
        onSubmit={async (reason) =>
          toastResult(await cancelTask({ taskId: task.id, reason }), { success: "Task cancelled" })
        }
      />
      <ReasonDialog
        open={open === "reopen"}
        onOpenChange={(next) => setOpen(next ? "reopen" : null)}
        title="Reopen this task?"
        description="It goes back to the people on it and through the same approval route again."
        submitLabel="Reopen task"
        onSubmit={async (reason) =>
          toastResult(await reopenTask({ taskId: task.id, reason }), { success: "Task reopened" })
        }
      />
    </>
  );
}
