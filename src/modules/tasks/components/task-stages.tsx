"use client";

import { Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useOptimistic, useState } from "react";

import { cn } from "@/core/lib/utils";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { OFFLINE_BANNER_ID, useOnline } from "@/core/ui/connection/online";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import { toastResult } from "@/core/ui/toast";

import { removeTaskStage, tickStage } from "../actions/tasks";
import type { ActingFor } from "../domain/task";

/** Loaded on the first tap of Add stage, not with the page (4B review S12). */
const AddStageDialog = dynamic(
  () => import("./task-stage-dialog").then((module) => module.AddStageDialog),
  { ssr: false },
);

/** A stage as the page shows it: the tick's line is written on the server (IST, the pair). */
export type StageRow = { id: string; name: string; done: boolean; doneLine: string | null };

/**
 * A task's checklist (4.4; PRODUCT §4.6): an assignee ticks (a freelancer's coordinator ticks for
 * them, "Ticked by Ravi for Asha", ADR-0013) while the task is with its assignees; from Done on it
 * is locked (WORKFLOWS §3.1). The creator, the approving Admin and the Owner add stages and remove
 * an unticked one. Every tap goes through the stages guard (4A). A tick commits at the tap
 * (ARCHITECTURE §14.1): one request at a time, disabled offline like every commit, and a slow or
 * lost connection said under the list with Retry (the same tick again).
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
  const [busy, setBusy] = useState<string | null>(null);
  const online = useOnline();
  // The tick shows at once and holds until the saved stages arrive with the action's answer, so
  // the box never flips back for a frame between the two (a refusal or a lost reply puts it back).
  const [shown, showTick] = useOptimistic(
    stages,
    (current, change: { id: string; done: boolean }) =>
      current.map((stage) =>
        stage.id === change.id
          ? { ...stage, done: change.done, doneLine: change.done ? stage.doneLine : null }
          : stage,
      ),
  );
  const action = useAction(async (stageId: string, next: boolean) => {
    if (!tick) return;
    showTick({ id: stageId, done: next });
    toastResult(await tickStage({ taskId, stageId, done: next, onBehalfOf: tick.onBehalfOf }));
  });
  const { pending } = action;
  const [adding, setAdding] = useState(false);
  // Mounted from the first Add stage on, so its typed name survives a back (4B review L6).
  const [addLoaded, setAddLoaded] = useState(false);
  const [removing, setRemoving] = useState<StageRow | null>(null);
  const done = shown.filter((stage) => stage.done).length;

  function toggle(stage: StageRow, next: boolean) {
    if (!tick || pending) return;
    setBusy(stage.id);
    action.run(stage.id, next);
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
      {shown.length > 0 ? (
        <ul className="border-border divide-border bg-card divide-y rounded-lg border">
          {shown.map((stage) => (
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
                {pending && busy === stage.id ? (
                  <Loader2Icon
                    className="text-muted-foreground size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                ) : (
                  <Checkbox
                    checked={stage.done}
                    disabled={!tick || pending || !online}
                    onCheckedChange={(value) => toggle(stage, value === true)}
                    aria-label={stage.name}
                    {...(tick && !online ? { "aria-describedby": OFFLINE_BANNER_ID } : {})}
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
      <ActionStatus action={action} />
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
          onClick={() => {
            setAddLoaded(true);
            setAdding(true);
          }}
        >
          <PlusIcon aria-hidden />
          Add stage
        </Button>
      ) : null}

      {addLoaded ? (
        <AddStageDialog open={adding} onClose={() => setAdding(false)} taskId={taskId} />
      ) : null}
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
