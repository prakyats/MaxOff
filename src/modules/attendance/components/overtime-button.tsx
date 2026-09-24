"use client";

import { useState } from "react";

import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { toastResult } from "@/core/ui/toast";
import { Button } from "@/core/ui/primitives/button";

import { flagOvertime } from "../actions/attendance";

/** Flag overtime on today's day, with a reason (WORKFLOWS §1). A notice: nobody approves it. */
export function OvertimeButton({ dayId }: { dayId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} className="w-full md:w-auto">
        Flag overtime
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Flag overtime"
        description="A note for the Owner that you worked beyond your hours today. Nothing needs approving."
        label="What kept you"
        submitLabel="Flag overtime"
        onSubmit={async (reason) => {
          toastResult(await flagOvertime({ dayId, reason }), { success: "Overtime flagged" });
        }}
      />
    </>
  );
}
