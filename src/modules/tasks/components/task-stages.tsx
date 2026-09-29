"use client";

import { Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
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

import { addTaskStage, removeTaskStage, tickStage } from "../actions/tasks";
import { STAGE_NAME_MAX } from "../domain/limits";
import type { ActingFor } from "../domain/task";

/** A stage as the page shows it: the tick's line is written on the server (IST, the pair). */
export type StageRow = { id: string; name: string; done: boolean; doneLine: string | null };

/**
 * A task's checklist (4.4; PRODUCT §4.6): an assignee ticks (a freelancer's coordinator ticks for
 * them, "Ticked by Ravi for Asha", ADR-0013) while the task is with its assignees; from Done on it
 * is locked (WORKFLOWS §3.1). The creator, the approving Admin and the Owner add stages and remove
 * an unticked one. Every tap goes through the stages guard (4A).
 */
export function TaskStages({
  taskId,
  stages,
  tick,
  canManage,
  lockedNote,
}: {
  taskId: string;
  stages: StageRow[];
  tick: ActingFor | null;
  canManage: boolean;
  lockedNote: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<StageRow | null>(null);
  const done = stages.filter((stage) => stage.done).length;

  function toggle(stage: StageRow, next: boolean) {
    if (!tick) return;
    setBusy(stage.id);
    startTransition(async () => {
      toastResult(
        await tickStage({ taskId, stageId: stage.id, done: next, onBehalfOf: tick.onBehalfOf }),
      );
      setBusy(null);
    });
  }

  return (
    <section
      aria-labelledby="task-stages-title"
      data-slot="task-stages"
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="task-stages-title" className="text-sm font-semibold">
          Stages
        </h2>
        {stages.length > 0 ? (
          <span className="text-muted-foreground text-xs" data-slot="task-stages-count">
            {done} of {stages.length} done
          </span>
        ) : null}
      </div>
      {stages.length > 0 ? (
        <ul className="border-border divide-border bg-card divide-y rounded-lg border">
          {stages.map((stage) => (
            <li
              key={stage.id}
              data-slot="task-stage"
              data-done={stage.done ? "true" : "false"}
              className="flex items-center gap-1 pr-1"
            >
              <label
                className={cn(
                  "flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2 pl-3",
                  tick ? "cursor-pointer" : "cursor-default",
                )}
              >
                {busy === stage.id ? (
                  <Loader2Icon
                    className="text-muted-foreground size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                ) : (
                  <Checkbox
                    checked={stage.done}
                    disabled={!tick || pending}
                    onCheckedChange={(value) => toggle(stage, value === true)}
                    aria-label={stage.name}
                  />
                )}
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      "text-sm break-words",
                      stage.done && "text-muted-foreground line-through",
                    )}
                  >
                    {stage.name}
                  </span>
                  {stage.doneLine ? (
                    <span className="text-muted-foreground text-xs break-words">
                      {stage.doneLine}
                    </span>
                  ) : null}
                </span>
              </label>
              {canManage && !stage.done ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0"
                  aria-label={`Remove stage ${stage.name}`}
                  disabled={pending}
                  onClick={() => setRemoving(stage)}
                >
                  <XIcon aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          No stages. Add one to break the work into steps.
        </p>
      )}
      {lockedNote && stages.length > 0 ? (
        <p className="text-muted-foreground text-xs" data-slot="task-stages-locked">
          {lockedNote}
        </p>
      ) : null}
      {canManage ? (
        <Button
          type="button"
          variant="secondary"
          className="h-11 self-start"
          onClick={() => setAdding(true)}
        >
          <PlusIcon aria-hidden />
          Add stage
        </Button>
      ) : null}

      {adding ? <AddStageDialog taskId={taskId} onClose={() => setAdding(false)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove this stage?"
        description={
          removing
            ? `“${removing.name}” is taken off the checklist. The history keeps it.`
            : undefined
        }
        confirmLabel="Remove stage"
        onConfirm={async () =>
          removing
            ? toastResult(await removeTaskStage({ taskId, stageId: removing.id }), {
                success: "Stage removed",
              })
            : true
        }
      />
    </section>
  );
}

function AddStageDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name the stage.");
      return;
    }
    startTransition(async () => {
      const result = await addTaskStage({ taskId, name });
      if (!result.ok) {
        setError(result.error.fieldErrors?.name?.[0] ?? result.error.message);
        return;
      }
      toastResult(result, { success: "Stage added" });
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
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
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Add stage
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
