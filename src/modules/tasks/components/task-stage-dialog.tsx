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
import { Input } from "@/core/ui/primitives/input";
import { toastResult } from "@/core/ui/toast";

import { addTaskStage } from "../actions/tasks";
import { STAGE_NAME_MAX } from "../domain/limits";

/**
 * "Add a stage" (4.4), loaded on the first tap of Add stage (4B review S12). It stays mounted after
 * that, so a name typed before a back is still there on the next open (§14.2 f; 4B review L6).
 * A create (ARCHITECTURE §14.1): after a lost reply it offers no Retry, which could add the stage
 * twice.
 */
export function AddStageDialog({
  open,
  onClose,
  taskId,
}: {
  open: boolean;
  onClose: () => void;
  taskId: string;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const action = useAction(
    async () => {
      const result = await addTaskStage({ taskId, name });
      if (!result.ok) {
        setError(result.error.fieldErrors?.name?.[0] ?? result.error.message);
        return;
      }
      toastResult(result, { success: "Stage added" });
      setName("");
      onClose();
    },
    { resetKey: open, creates: true },
  );
  const { pending } = action;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name the stage.");
      return;
    }
    action.run();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next || pending ? undefined : onClose())}>
      <DialogContent data-slot="task-stage-dialog">
        <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add a stage</DialogTitle>
            <DialogDescription>It goes at the end of the checklist.</DialogDescription>
          </DialogHeader>
          <FormField label="Stage" error={error ?? undefined}>
            {(control) => (
              <Input
                {...control}
                name="stage"
                value={name}
                maxLength={STAGE_NAME_MAX}
                autoComplete="off"
                autoFocus
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
            )}
          </FormField>
          <ActionStatus action={action} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" pending={pending} pendingLabel="Adding…">
              Add stage
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
