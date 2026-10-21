"use client";

import { useState } from "react";
import { toast } from "sonner";

import { GROUP_LABEL_MAX } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
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
import { describeError } from "@/core/ui/toast";

import { groupItemStages } from "../actions/items";

/** The deliverable as the dialog splits it: its title and its stages in order. */
export type GroupStagesTarget = {
  itemId: string;
  title: string;
  stages: readonly { id: string; name: string }[];
};

/**
 * "Group stages" (V3, the long-stage-list fix D, owner 2026-10-17): the Admin chooses where each
 * group starts and names it; the first group starts at the first stage. Nothing is grouped until
 * they press "Group stages", and only this deliverable changes (ticks and order kept;
 * `item_stages_group`). Mounted while open (its code loads on the first tap, ARCHITECTURE §19). A
 * layer (§14.2 a): back closes it, asking "Discard these groups?" first once something was chosen.
 */
export function GroupStagesDialog({
  target,
  onClose,
}: {
  target: GroupStagesTarget;
  onClose: () => void;
}) {
  const first = target.stages[0]?.id ?? "";
  // Each group start's name, by the stage it starts at; the first stage always starts one.
  const [names, setNames] = useState<Readonly<Record<string, string>>>({ [first]: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"form" | "discard">("form");
  const starts = target.stages.filter((stage) => stage.id in names);
  const dirty = starts.length > 1 || Object.values(names).some((name) => name.trim() !== "");

  function toggle(stageId: string) {
    if (stageId === first) return;
    setNames((current) => {
      const next = { ...current };
      if (stageId in next) delete next[stageId];
      else next[stageId] = "";
      return next;
    });
  }

  function requestClose() {
    if (pending) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (starts.length < 2) {
      setError("Choose at least one more stage where a group starts.");
      return;
    }
    if (starts.some((stage) => (names[stage.id] ?? "").trim() === "")) {
      setError("Give every group a name.");
      return;
    }
    setPending(true);
    const result = await groupItemStages({
      itemId: target.itemId,
      groups: starts.map((stage) => ({ label: names[stage.id] ?? "", start: stage.id })),
    });
    setPending(false);
    if (!result.ok) {
      const { title, description } = describeError(result.error);
      setError(description ?? title);
      return;
    }
    toast.success(`Grouped the stages of ${target.title}`);
    onClose();
  }

  const groupNumber = new Map(starts.map((stage, index) => [stage.id, index + 1]));
  return (
    <>
      <Dialog
        open={phase === "form"}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent data-slot="group-stages-dialog">
          <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Group the stages of {target.title}</DialogTitle>
              <DialogDescription>
                Tap the stage where each new group starts, then name the groups. Ticks and the order
                stay as they are; other deliverables are not changed.
              </DialogDescription>
            </DialogHeader>
            {error ? <ErrorText slot="form-alert">{error}</ErrorText> : null}
            <ol aria-label={`Stages of ${target.title}`} className="flex min-w-0 flex-col gap-1">
              {target.stages.map((stage, index) => {
                const group = groupNumber.get(stage.id);
                const isStart = group !== undefined;
                return (
                  <li
                    key={stage.id}
                    data-slot="group-stages-row"
                    data-start={isStart ? "" : undefined}
                    className={cn("flex min-w-0 flex-col gap-1", isStart && index > 0 && "pt-2")}
                  >
                    {isStart ? (
                      <label className="flex min-w-0 flex-col gap-1">
                        <span className="text-muted-foreground text-xs font-medium">
                          Group {group} name
                        </span>
                        <Input
                          data-slot="group-stages-name"
                          value={names[stage.id] ?? ""}
                          maxLength={GROUP_LABEL_MAX}
                          placeholder={group === 1 ? "e.g. Concept" : "e.g. Shoot"}
                          autoComplete="off"
                          onChange={(event) =>
                            setNames((current) => ({ ...current, [stage.id]: event.target.value }))
                          }
                        />
                      </label>
                    ) : null}
                    <button
                      type="button"
                      aria-pressed={isStart}
                      disabled={index === 0 || pending}
                      onClick={() => toggle(stage.id)}
                      data-slot="group-stages-start"
                      className="pressable-row hover:bg-muted focus-visible:ring-ring flex min-h-11 min-w-0 items-center gap-3 rounded-md px-2 text-left text-sm outline-none focus-visible:ring-2 disabled:cursor-default lg:min-h-9"
                    >
                      <span className="text-muted-foreground w-5 shrink-0 text-right text-xs tabular-nums">
                        {index + 1}
                      </span>
                      <span className="line-clamp-2 min-w-0 flex-1 break-words" title={stage.name}>
                        {stage.name}
                      </span>
                      {index > 0 ? (
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {isStart ? "Starts a group · undo" : "Start a group here"}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" pending={pending} pendingLabel="Grouping…">
                Group stages
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        destructive
        open={phase === "discard"}
        onOpenChange={(open) => {
          if (!open) setPhase("form");
        }}
        title="Discard these groups?"
        description="Nothing has been grouped yet."
        confirmLabel="Discard groups"
        cancelLabel="Keep editing"
        onConfirm={() => {
          onClose();
        }}
      />
    </>
  );
}
