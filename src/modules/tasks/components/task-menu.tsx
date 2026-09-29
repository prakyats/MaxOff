"use client";

import { Loader2Icon, MoreHorizontalIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";

import { FormField } from "@/core/ui/composites/form-field";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { toastResult } from "@/core/ui/toast";

import { cancelTask, reopenTask, setTaskApprover } from "../actions/tasks";
import type { TaskActions } from "../domain/task";
import type { AdminOption, Task, TaskAssignee } from "../domain/types";

import type { TaskFormSetup } from "./task-form-dialog";

const TaskFormDialog = dynamic(
  () => import("./task-form-dialog").then((module) => module.TaskFormDialog),
  { ssr: false },
);

const OWNER_APPROVES = "__owner__";

type Open = "edit" | "approver" | "cancel" | "reopen" | null;

/**
 * The task page's ⋯ (4.4; PERMISSIONS §3): Edit, Change approver (the Owner), Cancel and Reopen,
 * for the task's creator, its approving Admin and the Owner. Occasional actions, one tap deeper
 * than the task's next action (PRODUCT §2). A layer like every menu (§14.2 a); each item hands
 * off to its own dialog.
 */
export function TaskMenu({
  task,
  assignees,
  clientName,
  setup,
  admins,
  manage,
  changeApprover,
}: {
  task: Task;
  assignees: TaskAssignee[];
  clientName: string | null;
  setup: Promise<TaskFormSetup | null> | null;
  admins: AdminOption[];
  manage: TaskActions["manage"];
  changeApprover: boolean;
}) {
  const [open, setOpen] = useState<Open>(null);
  if (!manage.edit && !manage.cancel && !manage.reopen && !changeApprover) return null;

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

/** The Owner changes or removes the approving Admin (`task_set_approver`, WORKFLOWS §3.1). */
function ApproverDialog({
  taskId,
  current,
  admins,
  onClose,
}: {
  taskId: string;
  current: string | null;
  admins: AdminOption[];
  onClose: () => void;
}) {
  const [value, setValue] = useState(current ?? OWNER_APPROVES);
  const [pending, startTransition] = useTransition();
  const unchanged = value === (current ?? OWNER_APPROVES);

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const ok = toastResult(
        await setTaskApprover({
          taskId,
          approvingAdminId: value === OWNER_APPROVES ? null : value,
        }),
        { success: "Approver changed" },
      );
      if (ok) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent data-slot="task-approver-dialog">
        <form onSubmit={save} noValidate className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Change approver</DialogTitle>
            <DialogDescription>
              Who checks the task before you approve it. With nobody, it comes straight to you.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Checked first by">
            {(control) => (
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger
                  id={control.id}
                  className="w-full"
                  aria-describedby={control["aria-describedby"]}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OWNER_APPROVES}>Nobody: you approve it</SelectItem>
                  {admins.map((admin) => (
                    <SelectItem key={admin.id} value={admin.id}>
                      {admin.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={pending || unchanged}
              aria-busy={pending}
            >
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Save approver
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
