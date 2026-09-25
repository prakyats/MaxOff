"use client";

import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import type { ResultError } from "@/core/errors";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import { correctDay } from "../actions/review";
import { DAY_STATUSES, type DayStatus, STATUS_LABELS } from "../domain/choices";
import { firstName, historyDate } from "../domain/history";
import { ATTENDANCE_REASON_MAX_LENGTH } from "../domain/limits";
import { ErrorText } from "@/core/ui/composites/error-text";

export type CorrectTarget = {
  dayId: string;
  memberName: string;
  workDate: string;
  /** What the day is now (or was chosen), to start the select from. */
  current: DayStatus | null;
  /** The linked approved leave, when correcting to another leave type would leave it standing. */
  leaveType: DayStatus | null;
};

/**
 * The Owner sets what a day really was, with a reason (WORKFLOWS §1: any state, reason
 * required). **The reason field says who will read it** (owner decision 2026-09-24): the
 * member sees it on their own history.
 *
 * Only the dialog: whoever opens it holds it above anything that closes, so the review sheet
 * underneath stays open and one back closes this first (ARCHITECTURE §14.2 a).
 */
export function CorrectDayDialog({
  target,
  onOpenChange,
  onCorrected,
}: {
  target: CorrectTarget | null;
  onOpenChange: (open: boolean) => void;
  onCorrected?: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <CorrectForm
            key={target.dayId}
            target={target}
            onDone={() => {
              onOpenChange(false);
              onCorrected?.();
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CorrectForm({
  target,
  onDone,
  onCancel,
}: {
  target: CorrectTarget;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<DayStatus | "">(target.current ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();
  const name = firstName(target.memberName);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      // An empty choice goes to the schema, which answers with the field's own message.
      const result = await correctDay({ dayId: target.dayId, status: status as DayStatus, reason });
      if (result.ok) {
        toastResult(result, {
          success: `${name}'s day is now ${status ? STATUS_LABELS[status].toLowerCase() : "corrected"}`,
        });
        onDone();
      } else {
        setError(result.error);
      }
    });
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  // Correcting to a different leave type keeps the approved leave behind it (DATA-MODEL §3):
  // the Owner cancels that one from the person's leave if it should go.
  const keepsLeave =
    target.leaveType !== null &&
    status !== "" &&
    status !== target.leaveType &&
    status !== "present" &&
    status !== "absent";

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Correct {name}&apos;s day</DialogTitle>
        <DialogDescription>
          {historyDate(target.workDate)}. The original choice stays in the history.
        </DialogDescription>
      </DialogHeader>
      {summary ? (
        <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
      ) : null}
      <FormField label="The day was" error={fieldErrors.status}>
        {(control) => (
          <Select value={status} onValueChange={(next) => setStatus(next as DayStatus)}>
            <SelectTrigger
              id={control.id}
              className="w-full"
              aria-describedby={control["aria-describedby"]}
              aria-invalid={control["aria-invalid"]}
            >
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {DAY_STATUSES.map((option) => (
                <SelectItem key={option} value={option}>
                  {STATUS_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      {keepsLeave ? (
        <p data-slot="correct-keeps-leave" className="text-muted-foreground text-sm">
          Their approved {STATUS_LABELS[target.leaveType ?? "leave"].toLowerCase()} for this date
          stays. Cancel it from {name}&apos;s leave if it should go.
        </p>
      ) : null}
      <FormField
        label="Reason"
        hint={`${target.memberName} will see this reason.`}
        error={fieldErrors.reason}
      >
        {(control) => (
          <Textarea
            {...control}
            name="reason"
            rows={3}
            maxLength={ATTENDANCE_REASON_MAX_LENGTH}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        )}
      </FormField>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
          Save correction
        </Button>
      </DialogFooter>
    </form>
  );
}
