"use client";

import { Suspense, use, useEffect, useState } from "react";

import type { ResultError } from "@/core/errors";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
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
import { DateInput } from "@/core/ui/primitives/date-time-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import {
  requestCompLeave,
  requestLeave,
  requestLeaveChange,
  requestSplitLeave,
} from "../actions/leave";
import {
  COMP_KIND_LABELS,
  type CompBalance,
  compDateLabel,
  compDatesFor,
  type CompLeaveKind,
  compKindsAvailable,
  compLeaveLine,
  daysLabel,
} from "../domain/credits";
import {
  LEAVE_TYPE_LABELS,
  LEAVE_TYPES,
  leaveDates,
  leaveDayCount,
  type LeaveHalf,
  type LeaveType,
  leaveWhat,
  type MemberLeaveType,
  otherHalf,
  type OwnLeaveRequest,
} from "../domain/requests";
import { LEAVE_REASON_MAX_LENGTH } from "../domain/limits";
import { ErrorText } from "@/core/ui/composites/error-text";

import { HalfChoice, type HalfOption } from "./half-choice";

/** Morning off / Afternoon off (v1.9 W4, the working-hours sample §4). */
const HALF_OPTIONS: readonly HalfOption[] = [
  {
    value: "morning",
    label: "Morning off",
    hint: "Start your day after lunch. You won't be marked late",
  },
  {
    value: "afternoon",
    label: "Afternoon off",
    hint: "End your day after lunch. No need to ask to leave early",
  },
];

/** v2.0.1 "Full day: ½ comp + ½ leave": which half is comp leave (the other is ordinary leave). */
const COMP_HALF_OPTIONS: readonly HalfOption[] = [
  { value: "morning", label: "Comp in the morning" },
  { value: "afternoon", label: "Comp in the afternoon" },
];

/** "The afternoon is ordinary leave.": what the half that is not comp becomes. */
function splitNote(compHalf: LeaveHalf | null): string {
  if (!compHalf) return "The other half is ordinary leave.";
  return `The ${otherHalf(compHalf)} is ordinary leave.`;
}

/** What the "Kind of leave" select offers: the three leave types, plus comp leave with a credit. */
type Kind = LeaveType | CompLeaveKind;

const NO_BALANCE: CompBalance = { availableDays: 0, useBy: null };

/**
 * A new request, or a change to approved leave (WORKFLOWS §2). A half day is one date, so the
 * last-day field goes away for it. **Comp leave is offered only with a credit** (PRODUCT §4.3a,
 * 3b.2): a full or a half day, one date on or before the use-by date, from `balance` (a promise
 * the `/leave` layout hands over unawaited, read here inside a Suspense boundary so the header
 * never waits for it). A change never offers comp leave: a comp request is cancelled and made
 * again, not moved. The date fields' `min`/`max` are only hints for the picker: the form's own
 * check and then the database are the rule.
 */
export function LeaveFormDialog({
  today,
  original,
  balance,
  onClose,
}: {
  today: string;
  /** The approved leave being changed; absent for a new request. */
  original?: OwnLeaveRequest;
  /** The comp leave balance; absent (a change) offers no comp leave. */
  balance?: Promise<CompBalance>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{original ? "Change this leave" : "Request leave"}</DialogTitle>
          <DialogDescription>
            {original
              ? `Now: ${leaveWhat(original)} on ${leaveDates(original.startDate, original.endDate)}. It stays as it is until the Owner decides.`
              : "The Owner approves or declines it. You can withdraw it while it waits."}
          </DialogDescription>
        </DialogHeader>
        <Suspense fallback={<FormSkeleton />}>
          <LeaveForm
            today={today}
            original={original}
            balance={original || !balance ? null : balance}
            onClose={onClose}
            onPending={setPending}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}

/** "3 days", "½ day": the length of what is being asked for; nothing while the range is unset. */
function leaveLength(kind: Kind, startDate: string, endDate: string): string | null {
  if (kind === "half_day" || kind === "comp_half") return daysLabel(0.5);
  if (kind === "comp_full" || kind === "comp_split") return daysLabel(1);
  if (!startDate || !endDate || endDate < startDate) return null;
  return daysLabel(leaveDayCount(startDate, endDate));
}

/** The fields' tracing while the balance loads: a select, two dates, a reason, two buttons. */
function FormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4" data-slot="leave-form-skeleton">
      <Skeleton className="h-11 w-full" />
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-4 sm:flex-row">
          <Skeleton className="h-11 flex-1" />
          <Skeleton className="h-11 flex-1" />
        </div>
        {/* The length under the range ("1 day"). */}
        <div className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-12" />
        </div>
      </div>
      <Skeleton className="h-20 w-full" />
      <div className="flex justify-end gap-2">
        <Skeleton className="h-11 w-24" />
        <Skeleton className="h-11 w-32" />
      </div>
    </div>
  );
}

function LeaveForm({
  today,
  original,
  balance,
  onClose,
  onPending,
}: {
  today: string;
  original?: OwnLeaveRequest | undefined;
  balance: Promise<CompBalance> | null;
  onClose: () => void;
  onPending: (pending: boolean) => void;
}) {
  const comp = balance ? use(balance) : NO_BALANCE;
  const compKinds = original ? [] : compKindsAvailable(comp);
  const [kind, setKind] = useState<Kind>(original?.type ?? "leave");
  const [startDate, setStartDate] = useState(original?.startDate ?? today);
  const [endDate, setEndDate] = useState(original?.endDate ?? today);
  const [reason, setReason] = useState("");
  // v1.9 W4 (the working-hours sample §4): a half day asks which half; the first card is chosen,
  // as the sample shows it. v2.0.1: a change asks too, starting from the original's half, and
  // sends the one chosen (the function keeps the original's only when none is sent).
  const [half, setHalf] = useState<LeaveHalf>(original?.half ?? "morning");
  // v2.0.1: "Full day: ½ comp + ½ leave" asks which half is comp; nothing is chosen for them.
  const [compHalf, setCompHalf] = useState<LeaveHalf | null>(null);
  const [error, setError] = useState<ResultError | null>(null);
  const isSplit = kind === "comp_split";
  const isComp = kind === "comp_full" || kind === "comp_half" || isSplit;
  const asksHalf = kind === "half_day" || kind === "comp_half";
  const singleDate = kind === "half_day" || isComp;
  // Comp leave picks from the working days it can cover (3b review): a weekly day off or a
  // holiday is never offered. Without the list (it failed to load) the date field stays.
  const compDates = isComp && comp.dates ? compDatesFor(comp.dates, kind) : null;
  /** The one transition this form asks for: a split day, comp leave, a change, or leave. */
  function send() {
    if (isSplit) return requestSplitLeave({ date: startDate, compHalf, reason });
    if (isComp) {
      return requestCompLeave({
        date: startDate,
        halfDay: kind === "comp_half",
        reason,
        half: kind === "comp_half" ? half : null,
      });
    }
    const dates = { type: kind as MemberLeaveType, startDate, ...(singleDate ? {} : { endDate }) };
    const chosenHalf = kind === "half_day" ? half : null;
    if (original) {
      return requestLeaveChange({
        ...dates,
        reason,
        requestId: original.id,
        originalStart: original.startDate,
        half: chosenHalf,
      });
    }
    return requestLeave({ ...dates, reason, half: chosenHalf });
  }
  const action = useAction(
    async () => {
      const result = await send();
      if (result.ok) {
        toastResult(result, {
          success: original ? "Change sent to the Owner" : "Leave requested",
        });
        onClose();
      } else {
        setError(result.error);
      }
    },
    { creates: !original },
  );
  const { pending } = action;
  // The dialog around the form cannot close while the request is on its way (a failed one ends
  // pending too, so the dialog can close again).
  useEffect(() => onPending(pending), [onPending, pending]);

  function chooseKind(next: Kind) {
    setKind(next);
    if (next === "comp_full" || next === "comp_half" || next === "comp_split") {
      const offered = comp.dates ? compDatesFor(comp.dates, next) : null;
      if (offered && !offered.includes(startDate)) setStartDate(offered[0] ?? "");
    }
  }
  // A change may keep a start that has already passed (WORKFLOWS §2); nothing else may.
  const minStart = original && original.startDate < today ? original.startDate : today;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run();
  }

  const balanceText = compKinds.length > 0 ? compLeaveLine(comp) : null;
  const length = leaveLength(kind, startDate, endDate);
  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  const dateError = fieldErrors.startDate ?? fieldErrors.date;
  const submitLabel = original
    ? "Send change"
    : isSplit
      ? "Request full day"
      : asksHalf
        ? "Request half day"
        : "Request leave";

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {summary ? (
        <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
      ) : null}
      <FormField label="Kind of leave" error={fieldErrors.type}>
        {(control) => (
          <Select value={kind} onValueChange={(next) => chooseKind(next as Kind)}>
            <SelectTrigger
              id={control.id}
              className="w-full"
              aria-describedby={control["aria-describedby"]}
              aria-invalid={control["aria-invalid"]}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAVE_TYPES.filter((option) => option !== "comp_leave").map((option) => (
                <SelectItem key={option} value={option}>
                  {LEAVE_TYPE_LABELS[option]}
                </SelectItem>
              ))}
              {compKinds.map((option) => (
                <SelectItem key={option} value={option}>
                  {COMP_KIND_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      {/* PP-forms-5: what is left, above the dates (comp leave is the only balance kept). */}
      {balanceText ? (
        <p data-slot="leave-balance" className="text-muted-foreground -mb-1 text-sm">
          {balanceText}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-4 sm:flex-row">
          <FormField label={singleDate ? "Date" : "First day"} error={dateError} className="flex-1">
            {(control) =>
              compDates ? (
                <Select value={startDate} onValueChange={setStartDate}>
                  <SelectTrigger
                    id={control.id}
                    className="w-full"
                    aria-describedby={control["aria-describedby"]}
                    aria-invalid={control["aria-invalid"]}
                    data-field="comp-date"
                  >
                    <SelectValue placeholder="No working day left before the use-by date" />
                  </SelectTrigger>
                  <SelectContent>
                    {compDates.map((date) => (
                      <SelectItem key={date} value={date}>
                        {compDateLabel(date)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <DateInput
                  {...control}
                  name="startDate"
                  min={minStart}
                  {...(isComp && comp.useBy ? { max: comp.useBy } : {})}
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    // Keep the range the right way round while picking forward.
                    if (event.target.value > endDate) setEndDate(event.target.value);
                  }}
                  required
                />
              )
            }
          </FormField>
          {singleDate ? null : (
            <FormField label="Last day" error={fieldErrors.endDate} className="flex-1">
              {(control) => (
                <DateInput
                  {...control}
                  name="endDate"
                  min={startDate || minStart}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  required
                />
              )}
            </FormField>
          )}
        </div>
        {/* PP-forms-5: how long it is, worked out under the range. */}
        {length ? (
          <p data-slot="leave-length" aria-live="polite" className="text-muted-foreground text-sm">
            {length}
          </p>
        ) : null}
      </div>
      {asksHalf ? (
        <HalfChoice
          legend="Which half?"
          name="half"
          options={HALF_OPTIONS}
          value={half}
          onChange={setHalf}
          error={fieldErrors.half?.[0]}
        />
      ) : null}
      {isSplit ? (
        <HalfChoice
          legend="Comp half"
          name="compHalf"
          slot="comp-half-choice"
          options={COMP_HALF_OPTIONS}
          value={compHalf}
          onChange={setCompHalf}
          note={splitNote(compHalf)}
          error={fieldErrors.compHalf?.[0]}
        />
      ) : null}
      <FormField label="Reason (optional)" error={fieldErrors.reason}>
        {(control) => (
          <Textarea
            {...control}
            name="reason"
            rows={3}
            maxLength={LEAVE_REASON_MAX_LENGTH}
            placeholder="Anything the Owner should know."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </FormField>
      <ActionStatus action={action} />
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          disabled={pending}
          data-dismiss=""
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          pending={pending}
          pendingLabel={original ? "Sending change…" : "Sending request…"}
        >
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
