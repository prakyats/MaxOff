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
import { Input } from "@/core/ui/primitives/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import { requestLeave, requestLeaveChange } from "../actions/leave";
import {
  LEAVE_TYPE_LABELS,
  LEAVE_TYPES,
  leaveDates,
  type LeaveType,
  type OwnLeaveRequest,
} from "../domain/requests";
import { LEAVE_REASON_MAX_LENGTH } from "../domain/limits";

/**
 * A new request, or a change to approved leave (WORKFLOWS §2). A half day is one date, so the
 * last-day field goes away for it. The date fields' `min` is only a hint for the picker: the
 * form's own check and then the database are the rule.
 */
export function LeaveFormDialog({
  today,
  original,
  onClose,
}: {
  today: string;
  /** The approved leave being changed; absent for a new request. */
  original?: OwnLeaveRequest;
  onClose: () => void;
}) {
  const [type, setType] = useState<LeaveType>(original?.type ?? "leave");
  const [startDate, setStartDate] = useState(original?.startDate ?? today);
  const [endDate, setEndDate] = useState(original?.endDate ?? today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();
  const halfDay = type === "half_day";
  // A change may keep a start that has already passed (WORKFLOWS §2); nothing else may.
  const minStart = original && original.startDate < today ? original.startDate : today;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const fields = {
        type,
        startDate,
        ...(halfDay ? {} : { endDate }),
        reason,
      };
      const result = original
        ? await requestLeaveChange({
            ...fields,
            requestId: original.id,
            originalStart: original.startDate,
          })
        : await requestLeave(fields);
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

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{original ? "Change this leave" : "Request leave"}</DialogTitle>
            <DialogDescription>
              {original
                ? `Now: ${LEAVE_TYPE_LABELS[original.type].toLowerCase()} on ${leaveDates(original.startDate, original.endDate)}. It stays as it is until the Owner decides.`
                : "The Owner approves or declines it. You can withdraw it while it waits."}
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <p role="alert" data-slot="form-alert" className="text-destructive text-sm">
              {summary.description ?? summary.title}
            </p>
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
                    <SelectItem key={option} value={option}>
                      {LEAVE_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <div className="flex flex-col gap-4 sm:flex-row">
            <FormField
              label={halfDay ? "Date" : "First day"}
              error={fieldErrors.startDate}
              className="flex-1"
            >
              {(control) => (
                <Input
                  {...control}
                  name="startDate"
                  type="date"
                  min={minStart}
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    // Keep the range the right way round while picking forward.
                    if (event.target.value > endDate) setEndDate(event.target.value);
                  }}
                  required
                />
              )}
            </FormField>
            {halfDay ? null : (
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
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {original ? "Send change" : "Request leave"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
