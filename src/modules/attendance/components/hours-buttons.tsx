"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { systemClock } from "@/core/time/clock";
import { useFollowUpTrigger } from "@/core/ui/composites/follow-up";
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
  /** The ask's wait, read after the page (`getEarlyLeaveWait`); the sheet says it once known. */
  waitMinutes: Promise<number | null>;
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

/**
 * "Any expenses to claim today?" on the strip's approved early leave (v1.9 W4 Q1, advisor 2 Nov):
 * the Owner's approval ended the day, so End day's question never came; this quiet link opens the
 * same claim form End day's "Yes" opens (the page's `FollowUpHost`). None outside a host.
 */
export function ClaimExpensesLink({ date }: { date: string }) {
  const openClaims = useFollowUpTrigger();
  if (!openClaims) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => openClaims(date)}
      data-slot="early-leave-claim"
      className="text-muted-foreground hover:text-foreground -my-1 h-auto min-h-11 basis-full justify-start px-0 underline-offset-4 hover:bg-transparent hover:underline sm:min-h-8"
    >
      Any expenses to claim today?
    </Button>
  );
}
