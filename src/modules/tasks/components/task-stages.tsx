"use client";

import { Loader2Icon, MoreHorizontalIcon, PlusIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useOptimistic, useState } from "react";

import { cn } from "@/core/lib/utils";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { OFFLINE_BANNER_ID, useOnline } from "@/core/ui/connection/online";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import { moveItem } from "@/core/ui/reorder/reorder-math";
import { DragHandle, ReorderItem, ReorderList, ReorderMenuItems } from "@/core/ui/reorder/reorder";
import { useReorder } from "@/core/ui/reorder/use-reorder";
import { toastResult } from "@/core/ui/toast";

import { moveTaskStage, removeTaskStage, tickStage } from "../actions/tasks";
import { type ActingFor, stageMoveAs } from "../domain/task";

/** Loaded on the first tap of Add stage, not with the page (4B review S12). */
const AddStageDialog = dynamic(
  () => import("./task-stage-dialog").then((module) => module.AddStageDialog),
  { ssr: false },
);

/** A stage as the page shows it: the tick's line is written on the server (IST, the pair). */
export type StageRow = { id: string; name: string; done: boolean; doneLine: string | null };

/** What shows before the saved stages arrive: a tick or untick, or a move (6b.18). */
type StageChange =
  { kind: "tick"; id: string; done: boolean } | { kind: "move"; from: number; to: number };

/**
 * A task's checklist (4.4; PRODUCT §4.6): an assignee ticks (a freelancer's coordinator ticks for
 * them, "Ticked by Ravi for Asha", ADR-0013) while the task is with its assignees; from Done on it
 * is locked (WORKFLOWS §3.1). The creator, the approving Admin and the Owner add stages and remove
 * an unticked one. Every tap goes through the stages guard (4A). A tick commits at the tap
 * (ARCHITECTURE §14.1): one request at a time, disabled offline like every commit, and a slow or
 * lost connection said under the list with Retry (the same tick again).
 *
 * Drag to reorder (6b.18, owner 2026-10-13 option A): everyone on the task moves its stages, on an
 * existing task too (`stageMoveAs`: whoever may edit it, or whoever may tick), with the 44 px
 * handle at the row's end (a long press on a phone) or Move up / Move down in the row's ⋯ menu.
 * The new order shows at once and holds until the saved one arrives; ticks stay as they are, and
 * the move is in the history (`task_stage_move`). Adding and removing stay with the editors.
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
  const mover = stageMoveAs(canManage, tick);
  // A tick or a move shows at once and holds until the saved stages arrive with the action's
  // answer, so nothing flips back for a frame between the two (a refusal or a lost reply puts it
  // back).
  const [shown, showChange] = useOptimistic(stages, (current, change: StageChange) =>
    change.kind === "move"
      ? moveItem(current, change.from, change.to)
      : current.map((stage) =>
          stage.id === change.id
            ? { ...stage, done: change.done, doneLine: change.done ? stage.doneLine : null }
            : stage,
        ),
  );
  const action = useAction(async (stageId: string, next: boolean) => {
    if (!tick) return;
    showChange({ kind: "tick", id: stageId, done: next });
    toastResult(await tickStage({ taskId, stageId, done: next, onBehalfOf: tick.onBehalfOf }));
  });
  const moving = useAction(
    async (stageId: string, afterStageId: string | null, from: number, to: number) => {
      if (!mover) return;
      showChange({ kind: "move", from, to });
      toastResult(
        await moveTaskStage({ taskId, stageId, afterStageId, onBehalfOf: mover.onBehalfOf }),
      );
    },
  );
  const pending = action.pending || moving.pending;
  const reorder = useReorder({
    count: shown.length,
    labelOf: (index) => shown[index]?.name ?? "the stage",
    onMove: (from, to) => {
      const stage = shown[from];
      if (!stage) return;
      const next = moveItem(shown, from, to);
      moving.run(stage.id, to === 0 ? null : (next[to - 1]?.id ?? null), from, to);
    },
    disabled: !mover || pending || !online,
  });
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
        <ReorderList
          reorder={reorder}
          label="Stages"
          className="border-border bg-card rounded-lg border"
        >
          {shown.map((stage, index) => (
            <ReorderItem
              key={stage.id}
              reorder={reorder}
              index={index}
              data-slot="task-stage"
              data-done={stage.done ? "true" : "false"}
              className="border-border flex items-center gap-1 border-t pr-1 first:border-t-0"
            >
              <label
                className={cn(
                  "flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2 pl-3",
                  tick ? "cursor-pointer" : "cursor-default",
                )}
              >
                {action.pending && busy === stage.id ? (
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
              {mover && shown.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0"
                      aria-label={`Move ${stage.name}`}
                      data-slot="task-stage-menu"
                      disabled={pending || !online}
                    >
                      <MoreHorizontalIcon aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <ReorderMenuItems reorder={reorder} index={index} />
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
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
              {mover ? <DragHandle reorder={reorder} index={index} /> : null}
            </ReorderItem>
          ))}
        </ReorderList>
      ) : (
        <p className="text-muted-foreground text-sm">
          No stages. Add one to break the work into steps.
        </p>
      )}
      <ActionStatus action={action} />
      <ActionStatus action={moving} />
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
