"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import type { ResultError } from "@/core/errors";
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
import { DateInput } from "@/core/ui/primitives/date-time-input";
import { Label } from "@/core/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError } from "@/core/ui/toast";

import { ownerEditLeave } from "../actions/review";
import {
  LEAVE_TYPE_LABELS,
  LEAVE_TYPES,
  leaveDates,
  type LeaveHalf,
  type LeaveType,
  leaveWhat,
  type OwnLeaveRequest,
} from "../domain/requests";
import { keptDatesNote, ownerCompLeaveOption, ownerHalfCompOption } from "../domain/review";

import { HalfChoice, type HalfOption } from "./half-choice";

/** v2.0.1: which half of a half day is off, in the Owner's edit. */
const HALF_OPTIONS: readonly HalfOption[] = [
  { value: "morning", label: "Morning off" },
  { value: "afternoon", label: "Afternoon off" },
];
import { LEAVE_REASON_MAX_LENGTH } from "../domain/limits";
import { ErrorText } from "@/core/ui/composites/error-text";
import { displayName } from "@/core/lib/display-name";

/**
 * The Owner changes approved leave directly (`leave_owner_edit`, WORKFLOWS §2): any kind, any
 * dates, past included. The original is replaced by an Owner row; days the Owner had already
 * decided keep that decision, and the toast names them (2.2 follow-up a, closed in 2.4). Comp
 * leave is one date and draws one of the person's credits (3c review), so it is greyed out when
 * `compDays` says there is none; the database stays the rule and its refusal shows in the alert.
 * v2.0.1: a half day says **which half is off** and may **use ½ comp leave**; both start from the
 * original (its half, and whether it was a ½ comp day), so saving without touching them keeps
 * them. This is also how the Owner changes one half of an approved split day.
 */
export function OwnerEditLeaveDialog({
  request,
  memberName,
  compDays,
  onClose,
}: {
  request: OwnLeaveRequest;
  memberName: string;
  /** The person's comp leave balance today; undefined where the screen does not know it. */
  compDays?: number | undefined;
  onClose: () => void;
}) {
  const [type, setType] = useState<LeaveType>(request.type);
  const [startDate, setStartDate] = useState(request.startDate);
  const [endDate, setEndDate] = useState(request.endDate);
  const [reason, setReason] = useState("");
  // A half day's half and ½ comp start from the original's; a full day made a half day starts on
  // the morning, as the leave form does.
  const [half, setHalf] = useState<LeaveHalf | null>(
    request.type === "half_day" ? request.half : "morning",
  );
  const [halfComp, setHalfComp] = useState(request.type === "half_day" && !!request.creditDays);
  const [error, setError] = useState<ResultError | null>(null);
  const compId = useId();
  // A half day and comp leave are one date: no "Last day", and none is sent.
  const singleDate = type === "half_day" || type === "comp_leave";
  const comp = ownerCompLeaveOption(compDays, request, displayName(memberName));
  const isHalf = type === "half_day";
  const halfCompOption = ownerHalfCompOption(compDays, request, displayName(memberName), halfComp);
  const action = useAction(async () => {
    const result = await ownerEditLeave({
      requestId: request.id,
      type,
      startDate,
      ...(singleDate ? {} : { endDate }),
      reason,
      ...(isHalf ? { half, comp: halfComp && !halfCompOption.disabled } : {}),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const note = keptDatesNote(result.data.keptDates);
    toast.success("Leave changed", note ? { description: note } : undefined);
    onClose();
  });
  const { pending } = action;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run();
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit this leave</DialogTitle>
            <DialogDescription>
              Now: {leaveWhat(request)} on {leaveDates(request.startDate, request.endDate)}. Days
              you already decided keep that decision.
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}
          <FormField label="Kind of leave" error={fieldErrors.type}>
            {(control) => (
              <Select value={type} onValueChange={(next) => setType(next as LeaveType)}>
                <SelectTrigger
                  id={control.id}
                  className="w-full"
                  aria-describedby={control["aria-describedby"]}
                  aria-invalid={control["aria-invalid"]}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((option) => (
                    <SelectItem
                      key={option}
                      value={option}
                      disabled={option === "comp_leave" && comp.disabled}
                    >
                      {option === "comp_leave" && comp.disabled
                        ? "Comp leave (no credit)"
                        : LEAVE_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          {type === "comp_leave" && comp.hint ? (
            <p data-slot="edit-comp-hint" className="text-muted-foreground text-sm">
              {comp.hint}
            </p>
          ) : null}
          <div className="flex flex-col gap-4 sm:flex-row">
            <FormField
              label={singleDate ? "Date" : "First day"}
              error={fieldErrors.startDate}
              className="flex-1"
            >
              {(control) => (
                <DateInput
                  {...control}
                  name="startDate"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    if (event.target.value > endDate) setEndDate(event.target.value);
                  }}
                  required
                />
              )}
            </FormField>
            {singleDate ? null : (
              <FormField label="Last day" error={fieldErrors.endDate} className="flex-1">
                {(control) => (
                  <DateInput
                    {...control}
                    name="endDate"
                    min={startDate}
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    required
                  />
                )}
              </FormField>
            )}
          </div>
          {isHalf ? (
            <>
              <HalfChoice
                legend="Which half is off?"
                name="half"
                options={HALF_OPTIONS}
                value={half}
                onChange={setHalf}
                error={fieldErrors.half?.[0]}
              />
              <div className="flex flex-col gap-1">
                <div className="flex min-h-11 items-center gap-3">
                  <Checkbox
                    id={compId}
                    checked={halfComp && !halfCompOption.disabled}
                    disabled={halfCompOption.disabled}
                    onCheckedChange={(checked) => setHalfComp(checked === true)}
                    aria-describedby={halfCompOption.hint ? `${compId}-hint` : undefined}
                  />
                  <Label htmlFor={compId} className="leading-snug">
                    Use ½ comp leave for this half
                  </Label>
                </div>
                {halfCompOption.hint ? (
                  <p
                    id={`${compId}-hint`}
                    data-slot="edit-half-comp-hint"
                    className="text-muted-foreground text-sm"
                  >
                    {halfCompOption.hint}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
          <FormField
            label="Reason (optional)"
            hint={`${memberName} will see this reason.`}
            error={fieldErrors.reason}
          >
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                rows={3}
                maxLength={LEAVE_REASON_MAX_LENGTH}
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
            <Button variant="primary" type="submit" pending={pending} pendingLabel="Saving leave…">
              Save leave
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
