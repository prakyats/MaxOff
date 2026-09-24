"use client";

import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { toastResult } from "@/core/ui/toast";

import { flagOvertime } from "../actions/attendance";

/**
 * Flag overtime on a day, with a reason (WORKFLOWS §1). A notice: nobody approves it.
 *
 * Only the dialog: whoever opens it keeps it mounted above anything that closes. The history's
 * detail sheet closes when one of its actions is chosen (the hand-off), so a dialog rendered
 * next to the button inside the sheet would unmount with it and never appear.
 */
export function OvertimeDialog({
  dayId,
  onOpenChange,
}: {
  /** The day to flag; `null` keeps the dialog closed. */
  dayId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ReasonDialog
      open={dayId !== null}
      onOpenChange={onOpenChange}
      title="Flag overtime"
      description="A note for the Owner that you worked beyond your hours today. Nothing needs approving."
      label="What kept you"
      submitLabel="Flag overtime"
      onSubmit={async (reason) => {
        if (!dayId) return;
        toastResult(await flagOvertime({ dayId, reason }), { success: "Overtime flagged" });
      }}
    />
  );
}
