"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { toastResult } from "@/core/ui/toast";
import { Button } from "@/core/ui/primitives/button";

import { startDay } from "../actions/attendance";

/**
 * "I'm working today" on a day of approved full or comp leave (WORKFLOWS §1). Asks first: it
 * sends the day to the Owner for review as Present, and the leave request itself stays as it is.
 * Since 3b.1 it is a Start day (`attendance_start_day()`): the start time is recorded with it.
 * A half-day leave day needs no such button: Start day and End day stay available on it.
 */
export function WorkingTodayButton({ size = "default" }: { size?: "default" | "sm" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const label = "I'm working today";
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
        pendingLabel="Sending…"
        onConfirm={async () => {
          const result = await startDay();
          if (!toastResult(result, { success: "Sent to the Owner" })) return false;
          router.refresh();
          return true;
        }}
      />
    </>
  );
}
