"use client";

import { Loader2Icon } from "lucide-react";
import { Suspense, use, useState, useTransition } from "react";

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
import { Input } from "@/core/ui/primitives/input";
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

import { requestCompLeave, requestLeave, requestLeaveChange } from "../actions/leave";
import {
  COMP_KIND_LABELS,
  type CompBalance,
  compDateLabel,
  compDatesFor,
  type CompLeaveKind,
  compKindsAvailable,
  daysLabel,
  expiryLabel,
} from "../domain/credits";
import {
  LEAVE_TYPE_LABELS,
  LEAVE_TYPES,
  leaveDates,
  type LeaveType,
  type MemberLeaveType,
  type OwnLeaveRequest,
} from "../domain/requests";
import { LEAVE_REASON_MAX_LENGTH } from "../domain/limits";
import { ErrorText } from "@/core/ui/composites/error-text";

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
              ? `Now: ${LEAVE_TYPE_LABELS[original.type].toLowerCase()} on ${leaveDates(original.startDate, original.endDate)}. It stays as it is until the Owner decides.`
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

/** The fields' tracing while the balance loads: a select, two dates, a reason, two buttons. */
function FormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4" data-slot="leave-form-skeleton">
      <Skeleton className="h-11 w-full" />
      <div className="flex flex-col gap-4 sm:flex-row">
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="h-11 flex-1" />
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
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();
  const isComp = kind === "comp_full" || kind === "comp_half";
  const singleDate = kind === "half_day" || isComp;
  // Comp leave picks from the working days it can cover (3b review): a weekly day off or a
  // holiday is never offered. Without the list (it failed to load) the date field stays.
  const compDates = isComp && comp.dates ? compDatesFor(comp.dates, kind) : null;

  function chooseKind(next: Kind) {
    setKind(next);
    if (next === "comp_full" || next === "comp_half") {
      const offered = comp.dates ? compDatesFor(comp.dates, next) : null;
      if (offered && !offered.includes(startDate)) setStartDate(offered[0] ?? "");
    }
  }
  // A change may keep a start that has already passed (WORKFLOWS §2); nothing else may.
  const minStart = original && original.startDate < today ? original.startDate : today;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onPending(true);
    startTransition(async () => {
      const result = isComp
        ? await requestCompLeave({ date: startDate, halfDay: kind === "comp_half", reason })
        : original
          ? await requestLeaveChange({
              type: kind as MemberLeaveType,
              startDate,
              ...(singleDate ? {} : { endDate }),
              reason,
              requestId: original.id,
              originalStart: original.startDate,
            })
          : await requestLeave({
              type: kind as MemberLeaveType,
              startDate,
              ...(singleDate ? {} : { endDate }),
              reason,
            });
      onPending(false);
      if (result.ok) {
        toastResult(result, {
          success: original ? "Change sent to the Owner" : "Leave requested",
        });
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  const dateError = fieldErrors.startDate ?? fieldErrors.date;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {summary ? (
        <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
      ) : null}
      <FormField
        label="Kind of leave"
        error={fieldErrors.type}
        {...(compKinds.length > 0 && comp.useBy
          ? {
              hint: `You have ${daysLabel(comp.availableDays)} of comp leave · ${expiryLabel(comp.useBy)}.`,
            }
          : {})}
      >
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
                  data-slot="comp-date"
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
              <Input
                {...control}
                name="startDate"
                type="date"
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
              <Input
                {...control}
                name="endDate"
                type="date"
                min={startDate || minStart}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                required
              />
            )}
          </FormField>
        )}
      </div>
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
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={pending} aria-busy={pending}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
          {original ? "Send change" : "Request leave"}
        </Button>
      </DialogFooter>
    </form>
  );
}
