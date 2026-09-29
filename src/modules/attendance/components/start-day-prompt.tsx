"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import type { ResultError } from "@/core/errors";
import { cn } from "@/core/lib/utils";
import { systemClock } from "@/core/time";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
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
import { Label } from "@/core/ui/primitives/label";
import { Textarea } from "@/core/ui/primitives/textarea";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
import { toastResult } from "@/core/ui/toast";

import { chooseLeaveToday } from "../actions/attendance";
import { CHOICE_COPY, PROMPT_LEAVE_CHOICES, type PromptLeaveChoice } from "../domain/choices";
import { ATTENDANCE_REASON_MAX_LENGTH } from "../domain/limits";
import { parseShownAt, promptDueNow, promptSnoozeKey } from "../domain/prompt";
import { dayLabel } from "../domain/today";

import { StartDayButton } from "./day-actions";

/**
 * The Start-day prompt (PRODUCT §4.2, kickoff 3b decision 3), mounted by the `(app)` layout on a
 * working day until the member has started or chosen leave. "Started working? Start your day to
 * record it." with **Start day**, "On leave today? Choose leave" (Leave / Half day: comp leave is
 * requested from the leave form) and **Just looking**. It opens when the app opens or comes back
 * to the foreground, **at most once every 30 minutes** (`domain/prompt.ts`; the timestamp lives in
 * `localStorage`, a per-device convenience). A bottom sheet on a phone (`Dialog`), one layer:
 * back, the backdrop and Just looking all close it and count as "not now" (ARCHITECTURE §14.2 a).
 * The leave choice is a second view of the same layer, never a second entry.
 */
export function StartDayPrompt({ memberId, workDate }: { memberId: string; workDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"ask" | "leave">("ask");
  const key = promptSnoozeKey(memberId, workDate);

  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "hidden") return;
      let last: number | null = null;
      try {
        last = parseShownAt(localStorage.getItem(key));
      } catch {
        // No storage (a private window, blocked site data): ask as if never asked.
      }
      if (promptDueNow(last, systemClock().getTime())) setOpen(true);
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [key]);

  function dismiss() {
    try {
      localStorage.setItem(key, String(systemClock().getTime()));
    } catch {
      // Without storage the prompt asks again on the next open, which is the safe side.
    }
    setOpen(false);
    setView("ask");
  }

  /**
   * Closes through history when the prompt owns the top entry (§14.2 e: a one-time layer never
   * stays in the back stack), else directly; then runs `after`. Both paths end in `dismiss()`.
   */
  function close(after?: () => void) {
    const done = () => {
      after?.();
    };
    if (!closeOverlaysThen(done)) {
      dismiss();
      done();
    }
  }

  return (
    // The marker says the prompt is mounted (the layout found the day unstarted) before the
    // effect opens it, so a test can tell "not due" from "not open yet" without a timer.
    <>
      <span hidden data-slot="start-day-prompt-mount" />
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
        <DialogContent data-slot="start-day-prompt">
          {view === "ask" ? (
            <>
              <DialogHeader>
                <DialogTitle>Started working?</DialogTitle>
                <DialogDescription>
                  {dayLabel(workDate)}. Start your day to record it: the start time is the moment
                  you tap.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <StartDayButton onStarted={() => close(() => router.refresh())} />
                <Button variant="secondary" onClick={() => setView("leave")}>
                  On leave today? Choose leave
                </Button>
                <Button variant="ghost" onClick={() => close()} data-slot="just-looking">
                  Just looking
                </Button>
              </div>
            </>
          ) : (
            <LeaveChoice
              workDate={workDate}
              onBack={() => setView("ask")}
              onDone={() => close(() => router.refresh())}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The prompt's leave view: Leave or Half day for today, an optional reason, sent to the Owner. */
function LeaveChoice({
  workDate,
  onBack,
  onDone,
}: {
  workDate: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState<PromptLeaveChoice | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const action = useAction(async () => {
    // Unchecked sends "": zod answers "Choose Leave or Half day."
    const result = await chooseLeaveToday({
      choice: (choice ?? "") as PromptLeaveChoice,
      reason,
    });
    if (toastResult(result, { success: "Sent to the Owner" })) onDone();
    else if (!result.ok) setError(result.error);
  });
  const { pending } = action;
  const choiceError = error?.fieldErrors?.choice?.[0];
  const reasonError = error?.fieldErrors?.reason?.[0];

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run();
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>On leave today?</DialogTitle>
        <DialogDescription>
          {dayLabel(workDate)}. The Owner reviews it. Comp leave is requested from Attendance &amp;
          leave.
        </DialogDescription>
      </DialogHeader>
      {error && !error.fieldErrors ? (
        <ErrorText slot="form-alert">{error.message}</ErrorText>
      ) : null}
      <fieldset className="flex flex-col gap-2" aria-invalid={choiceError ? true : undefined}>
        <legend className="mb-1 text-sm font-medium">Today I am on</legend>
        {PROMPT_LEAVE_CHOICES.map((option) => (
          <label
            key={option}
            data-slot="choice-option"
            className={cn(
              "border-border bg-card flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2",
              "has-[:checked]:border-strong has-[:checked]:bg-strong/5 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3",
            )}
          >
            <input
              type="radio"
              name="choice"
              value={option}
              checked={choice === option}
              onChange={() => {
                setChoice(option);
                setError(null);
              }}
              className="accent-strong size-5 shrink-0"
            />
            <span className="flex flex-col">
              <span className="font-medium">{CHOICE_COPY[option].label}</span>
              <span className="text-muted-foreground text-sm">{CHOICE_COPY[option].hint}</span>
            </span>
          </label>
        ))}
        {choiceError ? <ErrorText alert={false}>{choiceError}</ErrorText> : null}
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-reason`}>Reason (optional)</Label>
        <Textarea
          id={`${id}-reason`}
          rows={2}
          maxLength={ATTENDANCE_REASON_MAX_LENGTH}
          placeholder="Anything the Owner should know."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={reasonError ? true : undefined}
        />
        {reasonError ? <ErrorText alert={false}>{reasonError}</ErrorText> : null}
      </div>
      <ActionStatus action={action} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onBack} disabled={pending}>
          Back
        </Button>
        <Button variant="primary" type="submit" pending={pending} pendingLabel="Recording leave…">
          Record leave
        </Button>
      </DialogFooter>
    </form>
  );
}
