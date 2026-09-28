"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { toastResult } from "@/core/ui/toast";
import { Button } from "@/core/ui/primitives/button";

import { declareWorkingToday, startDay } from "../actions/attendance";

/**
 * "I'm working today" on a day of approved full or comp leave, or "I'm working the full day" on
 * a half day (WORKFLOWS §1). Asks first: it sends the day to the Owner for review as Present, and
 * the leave request itself stays as it is. On full leave it is a Start day (3b.1: the start time
 * is recorded with it, `attendance_start_day()`); on a half day the day is already started or
 * startable on its own, so it is the 2.1 `attendance_submit(present)`.
 */
export function WorkingTodayButton({
  label,
  forDate,
  size = "default",
}: {
  label: "I'm working today" | "I'm working the full day";
  forDate: string;
  /** `sm` on the one-line strip; the 44px touch minimum still applies on a phone. */
  size?: "default" | "sm";
}) {
  const router = useRouter();
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
          const result =
            label === "I'm working today"
              ? await startDay()
              : await declareWorkingToday({ forDate });
          if (!toastResult(result, { success: "Sent to the Owner" })) return false;
          router.refresh();
          return true;
        }}
      />
    </>
  );
}
