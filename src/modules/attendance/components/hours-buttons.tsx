"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { systemClock } from "@/core/time/clock";
import { Button } from "@/core/ui/primitives/button";

import { AskLeaveEarlySheetLazy, LateSheetLazy } from "./hours-sheets-lazy";

/**
 * The strip's working-hours buttons (v1.9 W4, sample §1–2). The sheets load after the page
 * (`hours-sheets-lazy.tsx`).
 */

/** Before the day's end time End day is "Ask to leave early" (sample §2): the same place and look. */
export function AskLeaveEarlyButton({
  size = "default",
  endAt,
  waitMinutes,
}: {
  size?: "default" | "sm";
  endAt: string;
  waitMinutes: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="strong"
        size={size}
        onClick={() => setOpen(true)}
        data-slot="ask-leave-early"
      >
        Ask to leave early
      </Button>
      <AskLeaveEarlySheetLazy
        open={open}
        onOpenChange={setOpen}
        endAt={endAt}
        waitMinutes={waitMinutes}
        onDone={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

/** A Late day with no reason yet: "Add a reason" opens the late sheet to add it (sample §1). */
export function LateReasonButton({
  minutes,
  suggestion,
}: {
  minutes: number;
  suggestion: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
        data-slot="late-add-reason"
      >
        Add a reason
      </Button>
      <LateSheetLazy
        open={open}
        onOpenChange={setOpen}
        mode="reason"
        minutes={minutes}
        suggestion={suggestion}
        onDone={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

/**
 * Re-reads the page when the strip next changes on its own (End day comes back after the wait, or
 * at the end time). Draws nothing; one timer, cleared when the page changes.
 */
export function RefreshAt({ at }: { at: string }) {
  const router = useRouter();
  useEffect(() => {
    const wait = new Date(at).getTime() - systemClock().getTime();
    // A timer longer than a day never fires correctly; the strip is re-read long before then.
    if (wait <= 0 || wait > 86_400_000) return;
    const timer = window.setTimeout(() => router.refresh(), wait + 1_000);
    return () => window.clearTimeout(timer);
  }, [at, router]);
  return null;
}
