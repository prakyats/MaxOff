"use client";

import { useId, useState } from "react";

import type { ResultError } from "@/core/errors";
import { cn } from "@/core/lib/utils";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Label } from "@/core/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import { decideEarlyLeave } from "../actions/hours";
import { correctDay } from "../actions/review";
import {
  compLeaveOption,
  CORRECT_CHOICE_LABELS,
  CORRECT_CHOICES,
  type CorrectChoice,
  DAY_STATUSES,
  type DayStatus,
  halfCompOption,
  SPLIT_DAY,
  STATUS_LABELS,
} from "../domain/choices";
import { historyDate } from "../domain/history";
import type { Half } from "../domain/hours";
import { ATTENDANCE_REASON_MAX_LENGTH } from "../domain/limits";
import { ErrorText } from "@/core/ui/composites/error-text";
import { displayName } from "@/core/lib/display-name";

export type CorrectTarget = {
  dayId: string;
  memberName: string;
  workDate: string;
  /** What the day is now (or was chosen), to start the select from; a split day starts as one. */
  current: CorrectChoice | null;
  /** v2.0.1: the day is off as two halves (a split day): a leave correction replaces them. */
  split?: boolean;
  /** v2.0.1: a half day's half off and whether it is a ½ comp day, to start those from. */
  currentHalf?: Half | null;
  currentComp?: boolean;
  /** The linked approved leave, when correcting to another leave type would leave it standing. */
  leaveType: DayStatus | null;
  /**
   * The person's comp leave balance today, or null where the screen does not know it
   * (Approvals): comp leave draws a credit (3c review), so with none the option is greyed out.
   */
  compDays: number | null;
  /**
   * A day left early without an answer (v1.9 W4): the correction goes through
   * `early_leave_decide(correct)`, which corrects the day beside the original and closes the request.
   */
  earlyLeaveId?: string;
};

/** v2.0.1: which half was off (a half day), and which half is comp (a split day). */
const HALF_OFF_OPTIONS: readonly { value: Half; label: string }[] = [
  { value: "morning", label: "Morning off" },
  { value: "afternoon", label: "Afternoon off" },
];
const COMP_HALF_OPTIONS: readonly { value: Half; label: string }[] = [
  { value: "morning", label: "Comp in the morning" },
  { value: "afternoon", label: "Comp in the afternoon" },
];

/**
 * The Owner sets what a day really was, with a reason (WORKFLOWS §1: any state, reason
 * required). **The reason field says who will read it** (owner decision 2026-09-24): the
 * member sees it on their own history.
 *
 * Only the dialog: whoever opens it holds it above anything that closes, so the review sheet
 * underneath stays open and one back closes this first (ARCHITECTURE §14.2 a).
 *
 * v2.0.1 (WORKFLOWS §2 "Settled in v2.0.1"): **Half day** asks which half was off and offers
 * **Use ½ comp leave** for it; **Full day: ½ comp + ½ leave** asks which half is comp (the other
 * is ordinary leave). Both draw ½ credit; `correctDaySchema` maps them to `attendance_decide`'s
 * `half` / `comp_half`. A day left early is corrected through `early_leave_decide`, which takes no
 * half, so it offers the plain statuses only.
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
  const [status, setStatus] = useState<CorrectChoice | "">(target.current ?? "");
  const [half, setHalf] = useState<Half | null>(target.currentHalf ?? null);
  const [halfComp, setHalfComp] = useState(target.currentComp ?? false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const name = displayName(target.memberName);
  const compId = useId();
  const early = target.earlyLeaveId !== undefined;
  const choices: readonly CorrectChoice[] = early ? DAY_STATUSES : CORRECT_CHOICES;
  const halfComps = halfCompOption(
    target.compDays,
    target.leaveType === "half_day" && (target.currentComp ?? false),
    name,
  );
  const action = useAction(
    async () => {
      // An empty choice goes to the schema, which answers with the field's own message.
      const result = target.earlyLeaveId
        ? await decideEarlyLeave({
            requestId: target.earlyLeaveId,
            decision: "correct",
            status: status as DayStatus,
            reason,
          })
        : await correctDay({
            dayId: target.dayId,
            status: status as CorrectChoice,
            half: status === "half_day" || status === SPLIT_DAY ? half : null,
            comp: status === "half_day" && halfComp && !halfComps.disabled,
            reason,
          });
      if (result.ok) {
        toastResult(result, {
          success: `${name}'s day is now ${status ? CORRECT_CHOICE_LABELS[status].toLowerCase() : "corrected"}`,
        });
        onDone();
      } else {
        setError(result.error);
      }
    },
    { resetKey: target.dayId },
  );
  const { pending } = action;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run();
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  // Any correction keeps the approved leave behind the day, Present and Absent included
  // (WORKFLOWS §1, owner decision 2026-09-26): the Owner cancels that one from the person's
  // Leave tab if it should go.
  // v2.0.1: a half day or a split day's own halves are replaced by a half-day or split correction
  // (and a split day's by any leave correction): nothing is left standing to cancel.
  const replacesLeave =
    (target.leaveType === "half_day" || target.split === true) &&
    (status === "half_day" ||
      status === SPLIT_DAY ||
      (target.split === true && (status === "leave" || status === "comp_leave")));
  const keepsLeave =
    target.leaveType !== null && status !== "" && status !== target.leaveType && !replacesLeave;
  // Comp leave uses one of the person's credits (kickoff 3b decision 16; the database is the
  // rule): the option is greyed out when there is none, and the hint names the balance.
  const comp = compLeaveOption(target.compDays, target.leaveType, name);
  const asksHalf = !early && status === "half_day";
  const isSplit = status === SPLIT_DAY;

  function choose(next: CorrectChoice) {
    // The half means something else for each: the half off, or the comp half. Start it empty
    // when switching between them, so nothing is carried over unseen.
    if ((next === SPLIT_DAY) !== (status === SPLIT_DAY)) setHalf(null);
    setStatus(next);
  }

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
          <Select value={status} onValueChange={(next) => choose(next as CorrectChoice)}>
            <SelectTrigger
              id={control.id}
              className="w-full"
              aria-describedby={control["aria-describedby"]}
              aria-invalid={control["aria-invalid"]}
            >
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((option) => {
                const noCredit =
                  (option === "comp_leave" && comp.disabled) ||
                  (option === SPLIT_DAY && halfComps.disabled);
                return (
                  <SelectItem key={option} value={option} disabled={noCredit}>
                    {noCredit
                      ? `${CORRECT_CHOICE_LABELS[option]} (no credit)`
                      : early
                        ? STATUS_LABELS[option as DayStatus]
                        : CORRECT_CHOICE_LABELS[option]}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
      </FormField>
      {status === "comp_leave" && comp.hint ? (
        <p data-slot="correct-comp-hint" className="text-muted-foreground text-sm">
          {comp.hint}
        </p>
      ) : null}
      {asksHalf ? (
        <>
          <HalfCards
            legend="Which half was off?"
            name="correct-half"
            options={HALF_OFF_OPTIONS}
            value={half}
            onChange={setHalf}
            error={fieldErrors.half?.[0]}
          />
          <div className="flex flex-col gap-1">
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id={compId}
                checked={halfComp && !halfComps.disabled}
                disabled={halfComps.disabled}
                onCheckedChange={(checked) => setHalfComp(checked === true)}
                aria-describedby={halfComps.hint ? `${compId}-hint` : undefined}
              />
              <Label htmlFor={compId} className="leading-snug">
                Use ½ comp leave for this half
              </Label>
            </div>
            {halfComps.hint && (halfComp || halfComps.disabled) ? (
              <p
                id={`${compId}-hint`}
                data-slot="correct-half-comp-hint"
                className="text-muted-foreground text-sm"
              >
                {halfComps.hint}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
      {isSplit ? (
        <HalfCards
          legend="Comp half"
          name="correct-comp-half"
          options={COMP_HALF_OPTIONS}
          value={half}
          onChange={setHalf}
          note={
            half
              ? `The ${half === "morning" ? "afternoon" : "morning"} is ordinary leave. ${halfComps.hint ?? ""}`.trim()
              : "The other half is ordinary leave."
          }
          error={fieldErrors.half?.[0]}
        />
      ) : null}
      {keepsLeave ? (
        <p data-slot="correct-keeps-leave" className="text-muted-foreground text-sm">
          {name}&apos;s approved leave stays. Cancel it from their Leave tab if it shouldn&apos;t.
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
        <Button variant="primary" type="submit" pending={pending} pendingLabel="Saving correction…">
          Save correction
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Radio cards for a half (44 px+ targets, the leave form's look): which half was off, or is comp. */
function HalfCards({
  legend,
  name,
  options,
  value,
  onChange,
  note,
  error,
}: {
  legend: string;
  name: string;
  options: readonly { value: Half; label: string }[];
  value: Half | null;
  onChange: (value: Half) => void;
  note?: string;
  error?: string | undefined;
}) {
  return (
    <fieldset className="flex flex-col gap-2" data-slot="correct-half-choice">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "border-border bg-card flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2.5",
            "has-[:checked]:border-strong has-[:checked]:bg-strong/5 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="accent-strong size-5 shrink-0"
          />
          <span className="font-medium">{option.label}</span>
        </label>
      ))}
      {note ? (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {note}
        </p>
      ) : null}
      {error ? <ErrorText alert={false}>{error}</ErrorText> : null}
    </fieldset>
  );
}
