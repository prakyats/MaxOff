"use client";

import { toast } from "sonner";

import { groupStageLabel } from "@/core/lib/stage-groups";
import { NETWORK_ERROR_MESSAGE } from "@/core/ui/action/network-error";
import { UNDO_MS } from "@/core/ui/delayed-sends";
import { toastResult } from "@/core/ui/toast";

import { tickItemStage } from "../actions/items";

type TickedStage = { id: string; name: string; groupLabel: string | null };

/**
 * One stage ticked or unticked (unit U: the row's stage chips and "Next: ‹stage›", the sheet's
 * ticks) through the same action as before (`item_stage_tick`, the same permission), then a toast
 * that says what happened ("Ticked Edit · Cut on Reel 1") with **Undo** for 6 seconds, which sends
 * the opposite tick: both stay in the deliverable's history, as two taps would. `pending` marks
 * the stage's control as waiting while the tick is on its way. `undo: false` (the sheet: its
 * modal layer covers the toasts, and the box itself is the undo) says what happened only.
 */
export async function tickWithUndo(
  stage: TickedStage,
  done: boolean,
  itemTitle: string,
  pending: (stageId: string | null) => void,
  { undo = true, undoing = false }: { undo?: boolean; undoing?: boolean } = {},
): Promise<boolean> {
  pending(stage.id);
  let result: Awaited<ReturnType<typeof tickItemStage>>;
  try {
    result = await tickItemStage({ stageId: stage.id, done });
  } catch {
    toast.error(NETWORK_ERROR_MESSAGE, { description: "Nothing was ticked or unticked." });
    return false;
  } finally {
    pending(null);
  }
  if (!result.ok) {
    toastResult(result);
    return false;
  }
  const said = `${done ? "Ticked" : "Unticked"} ${groupStageLabel(stage.groupLabel, stage.name)} on ${itemTitle}`;
  // The Undo's own word ("Unticked …") never takes the id of the toast whose Undo was tapped:
  // sonner removes that toast by id ~200 ms after the tap, so a reply quicker than that, merged
  // into it, went with it and the person never saw the Undo had worked.
  const id = undoing ? `item-tick-${stage.id}-undone` : `item-tick-${stage.id}`;
  if (undoing || !undo) {
    toast(said, { id });
    return true;
  }
  toast(said, {
    id,
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: () => void tickWithUndo(stage, !done, itemTitle, pending, { undoing: true }),
    },
  });
  return true;
}
