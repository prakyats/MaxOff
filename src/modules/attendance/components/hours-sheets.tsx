"use client";

import { RotateCcwIcon } from "lucide-react";
import { Suspense, use, useEffect, useState } from "react";

import type { ResultError } from "@/core/errors";
import { systemClock } from "@/core/time/clock";
import { clockWords } from "@/core/time/clock-words";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import { startDay } from "../actions/attendance";
import { addLateReason, askLeaveEarly } from "../actions/hours";
import {
  askSheetDescription,
  EARLY_REASON_MAX_LENGTH,
  LATE_REASON_MAX_LENGTH,
  LATE_SHEET_DESCRIPTION,
  lateSheetTitle,
} from "../domain/hours";

/**
 * The working-hours sheets (v1.9 W4; the approved sample `docs/design/v19-working-hours-sample.html`
 * §1–2), loaded after the page (`hours-sheets-lazy.tsx`): My Day and Today keep their first-load
 * budget. Each is one layer, a bottom sheet on a phone (`Dialog`); back, the backdrop and ✕ close it
 * and send nothing (ARCHITECTURE §14.2 a).
 */

/**
 * "You're starting 22 minutes late" (sample §1). `mode="start"`: Start day was tapped after the
 * start time and the grace; the sheet's **Start day** records the start with the reason (empty is
 * fine: it never blocks). `mode="reason"`: the day has started Late with no reason yet; **Save
 * reason** adds it. The reason starts from "Shoot at ‹time›" when a shoot is later today (OPEN 3).
 */
export function LateSheet({
  open,
  onOpenChange,
  mode,
  minutes,
  suggestion,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "start" | "reason";
  /** Minutes after the start time: worked out when the sheet opened. */
  minutes: number;
  suggestion: string | null;
  onDone: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="late-sheet">
        {open ? (
          <LateForm
            mode={mode}
            minutes={minutes}
            suggestion={suggestion}
            onDone={onDone}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LateForm({
  mode,
  minutes,
  suggestion,
  onDone,
  onCancel,
}: {
  mode: "start" | "reason";
  minutes: number;
  suggestion: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState(suggestion ?? "");
  const [error, setError] = useState<ResultError | null>(null);
  const action = useAction(async () => {
    const result =
      mode === "start" ? await startDay({ lateReason: reason }) : await addLateReason({ reason });
    if (result.ok) {
      toastResult(result, {
        success: mode === "start" ? "Your day has started" : "Reason added for the Owner",
      });
      onDone();
    } else {
      setError(result.error);
    }
  });
  const { pending } = action;
  const fieldError = error?.fieldErrors?.lateReason ?? error?.fieldErrors?.reason;
  const summary = error && !error.fieldErrors ? describeError(error) : null;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        action.run();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {mode === "start" ? lateSheetTitle(minutes) : "Why did you start late?"}
        </DialogTitle>
        <DialogDescription>{LATE_SHEET_DESCRIPTION}</DialogDescription>
      </DialogHeader>
      {summary ? (
        <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
      ) : null}
      {suggestion ? (
        <p
          data-slot="late-suggestion"
          className="bg-info-soft text-info inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
        >
          <RotateCcwIcon aria-hidden className="size-3.5" />
          Suggested from your calendar
        </p>
      ) : null}
      <FormField label="Reason (optional)" error={fieldError}>
        {(control) => (
          <Textarea
            {...control}
            name="lateReason"
            rows={2}
            maxLength={LATE_REASON_MAX_LENGTH}
            placeholder="Traffic, a shoot, a doctor's visit…"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
          />
        )}
      </FormField>
      <ActionStatus action={action} />
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={pending}
          data-dismiss=""
        >
          {mode === "start" ? "Not now" : "Cancel"}
        </Button>
        <Button
          variant="primary"
          type="submit"
          pending={pending}
          pendingLabel={mode === "start" ? "Starting…" : "Saving…"}
          data-slot={mode === "start" ? "late-start-day" : "late-save-reason"}
        >
          {mode === "start" ? "Start day" : "Save reason"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * "Ask to leave early" (sample §2): before the day's end time End day becomes this. The time asked
 * is the tap (nobody types a time; WORKFLOWS §1), shown as "Leave at"; why is required. **Ask the
 * Owner** sends it; the person stays checked in while waiting.
 */
export function AskLeaveEarlySheet({
  open,
  onOpenChange,
  endAt,
  waitMinutes,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endAt: string;
  waitMinutes: Promise<number | null>;
  onDone: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="ask-leave-early-sheet">
        {open ? (
          <AskForm
            endAt={endAt}
            waitMinutes={waitMinutes}
            onDone={onDone}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AskDescription({
  endAt,
  waitMinutes,
}: {
  endAt: string;
  waitMinutes: Promise<number | null>;
}) {
  return askSheetDescription(endAt, use(waitMinutes));
}

function AskForm({
  endAt,
  waitMinutes,
  onDone,
  onCancel,
}: {
  endAt: string;
  waitMinutes: Promise<number | null>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const now = useNow();
  const action = useAction(async () => {
    const result = await askLeaveEarly({ reason });
    if (result.ok) {
      toastResult(result, { success: "Asked the Owner" });
      onDone();
    } else {
      setError(result.error);
    }
  });
  const { pending } = action;
  const summary = error && !error.fieldErrors ? describeError(error) : null;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        action.run();
      }}
    >
      <DialogHeader>
        <DialogTitle>Ask to leave early</DialogTitle>
        <DialogDescription>
          {/* The wait is read after the page and has long arrived by the time the sheet opens;
              until it has, the sentence without it. */}
          <Suspense fallback={askSheetDescription(endAt, null)}>
            <AskDescription endAt={endAt} waitMinutes={waitMinutes} />
          </Suspense>
        </DialogDescription>
      </DialogHeader>
      {summary ? (
        <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Leave at</span>
        <span
          data-slot="ask-leave-at"
          className="border-border bg-muted/40 flex min-h-11 w-fit min-w-32 items-center rounded-lg border px-3 tabular-nums"
        >
          {now ?? " "}
        </span>
        <span className="text-muted-foreground text-xs">
          The time you tap Ask the Owner is the time recorded.
        </span>
      </div>
      <FormField label="Why" error={error?.fieldErrors?.reason}>
        {(control) => (
          <Textarea
            {...control}
            name="reason"
            rows={2}
            maxLength={EARLY_REASON_MAX_LENGTH}
            placeholder="Doctor's appointment at 5"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
            required
          />
        )}
      </FormField>
      <ActionStatus action={action} />
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={pending}
          data-dismiss=""
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          pending={pending}
          pendingLabel="Asking…"
          data-slot="ask-the-owner"
        >
          Ask the Owner
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The time now, "4:30 pm", refreshed every 15 seconds; nothing before hydration. */
function useNow(): string | null {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(clockWords(systemClock()));
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
