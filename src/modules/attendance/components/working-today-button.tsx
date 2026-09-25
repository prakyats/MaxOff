"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { toastResult } from "@/core/ui/toast";
import { Button } from "@/core/ui/primitives/button";

import { declareWorkingToday } from "../actions/attendance";

/**
 * "I'm working today" (full or comp leave) / "I'm working the full day" (half day) on a day of
 * approved leave (WORKFLOWS §1). Asks first: it sends the day to the Owner for review, and the
 * leave request itself stays as it is.
 */
export function WorkingTodayButton({
  label,
  forDate,
  size = "default",
}: {
  label: string;
  forDate: string;
  /** `sm` on the one-line strip; the 44px touch minimum still applies on a phone. */
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size={size}
        onClick={() => setOpen(true)}
        className={size === "sm" ? undefined : "w-full md:w-auto"}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`${label}?`}
        description="The Owner reviews it. If approved, today counts as a day worked; your leave request stays as it is."
        confirmLabel={label}
        onConfirm={async () => {
          toastResult(await declareWorkingToday({ forDate }), { success: "Sent to the Owner" });
        }}
      />
    </>
  );
}
