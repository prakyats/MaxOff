"use client";

import { useState } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { FormField } from "@/core/ui/composites/form-field";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { toastResult } from "@/core/ui/toast";

import { setTaskApprover } from "../actions/tasks";
import type { AdminOption } from "../domain/types";

const OWNER_APPROVES = "__owner__";

/** The Owner changes or removes the approving Admin (`task_set_approver`, WORKFLOWS §3.1). */
export function ApproverDialog({
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
  const unchanged = value === (current ?? OWNER_APPROVES);
  // The choice is read when it runs, so a Retry sends the one on screen now.
  const action = useAction(async () => {
    const ok = toastResult(
      await setTaskApprover({
        taskId,
        approvingAdminId: value === OWNER_APPROVES ? null : value,
      }),
      { success: "Approver changed" },
    );
    if (ok) onClose();
  });
  const { pending } = action;

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run();
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
          <ActionStatus action={action} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={unchanged}
              pending={pending}
              pendingLabel="Saving…"
            >
              Save approver
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
