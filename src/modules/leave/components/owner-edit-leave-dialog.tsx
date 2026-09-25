"use client";

import { Loader2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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
import { describeError } from "@/core/ui/toast";

import { ownerEditLeave } from "../actions/review";
import {
  LEAVE_TYPE_LABELS,
  LEAVE_TYPES,
  leaveDates,
  type LeaveType,
  type OwnLeaveRequest,
} from "../domain/requests";
import { keptDatesNote } from "../domain/review";
import { LEAVE_REASON_MAX_LENGTH } from "../domain/limits";

/**
 * The Owner changes approved leave directly (`leave_owner_edit`, WORKFLOWS §2): any kind, any
 * dates, past included. The original is replaced by an Owner row; days the Owner had already
 * decided keep that decision, and the toast names them (2.2 follow-up a, closed in 2.4).
 */
export function OwnerEditLeaveDialog({
  request,
  memberName,
  onClose,
}: {
  request: OwnLeaveRequest;
  memberName: string;
  onClose: () => void;
}) {
  const [type, setType] = useState<LeaveType>(request.type);
  const [startDate, setStartDate] = useState(request.startDate);
  const [endDate, setEndDate] = useState(request.endDate);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();
  const halfDay = type === "half_day";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await ownerEditLeave({
        requestId: request.id,
        type,
        startDate,
        ...(halfDay ? {} : { endDate }),
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const note = keptDatesNote(result.data.keptDates);
      toast.success("Leave changed", note ? { description: note } : undefined);
      onClose();
    });
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
              Now: {LEAVE_TYPE_LABELS[request.type].toLowerCase()} on{" "}
              {leaveDates(request.startDate, request.endDate)}. Days you already decided keep that
              decision.
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
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
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
                    min={startDate}
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    required
                  />
                )}
              </FormField>
            )}
          </div>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Save leave
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
