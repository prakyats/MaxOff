"use client";

import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";

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
