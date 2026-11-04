"use client";

import { useState } from "react";

import type { ResultError } from "@/core/errors/result";
import { isISODate, isISTTime, istInstant, systemClock, todayIST, toISTTime } from "@/core/time";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import { DateInput, TimeInput } from "@/core/ui/primitives/date-time-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { describeError, toastResult } from "@/core/ui/toast";

import { resumeTask } from "../actions/tasks";
import { resumeDeadlineProblem } from "../domain/hold";

/**
 * Resume with a new deadline (v1.9 W8; WORKFLOWS §3.1a; the approved sample §1): the deadline
 * passed while the task was on hold, so a new one is required; the old one stays in History. A
 * layer: back, Esc and "Not yet" close it (§14.2 a); a bottom sheet on a phone (§14.1). Loaded
 * after the page, on the first tap (ARCHITECTURE §19). `task_resume` decides again.
 */
export function TaskResumeDialog({
  open,
  onOpenChange,
  taskId,
  title,
  dueAt,
  dueLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  title: string;
  dueAt: string;
  /** "Mon 26 Oct, 6:00 pm": the deadline that passed. */
  dueLabel: string;
}) {
  const [date, setDate] = useState("");
  // The old deadline's time is the likeliest new one.
  const [time, setTime] = useState(() => toISTTime(dueAt));
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<ResultError | null>(null);

  function problem(): string | null {
    if (!isISODate(date)) return "Choose the new deadline's date.";
    if (!isISTTime(time)) return "Choose the new deadline's time.";
    return resumeDeadlineProblem({ dueAt, heldAt: "held" }, istInstant(date, time), systemClock());
  }

  const action = useAction(
    async () => {
      const found = problem();
      if (found) {
        setError(found);
        return;
      }
      const result = await resumeTask({ taskId, newDueAt: istInstant(date, time) });
      if (!result.ok) {
        if (result.error.code === "VALIDATION") setError(result.error.message);
        else setFormError(result.error);
        return;
      }
      toastResult(result, { success: "Task resumed with its new deadline" });
      setDate("");
      onOpenChange(false);
    },
    { resetKey: open },
  );
  const { pending } = action;

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setError(null);
      setFormError(null);
    }
    onOpenChange(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = problem();
    setError(found);
    if (found) return;
    action.run();
  }

  const summary = formError ? describeError(formError) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-slot="task-resume-dialog">
        <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="break-words">Resume &ldquo;{title}&rdquo;</DialogTitle>
            <DialogDescription>
              The deadline ({dueLabel}) has passed. Set a new one.
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <FormField label="New deadline" error={error ?? undefined}>
              {(control) => (
                <DateInput
                  {...control}
                  name="dueDate"
                  min={todayIST()}
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setError(null);
                  }}
                  required
                />
              )}
            </FormField>
            <FormField label="Time">
              {(control) => (
                <TimeInput
                  {...control}
                  name="dueTime"
                  value={time}
                  onChange={(event) => {
                    setTime(event.target.value);
                    setError(null);
                  }}
                  required
                />
              )}
            </FormField>
          </div>
          <ActionStatus action={action} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => close(false)}
              disabled={pending}
              data-dismiss=""
            >
              Not yet
            </Button>
            <Button variant="primary" type="submit" pending={pending} pendingLabel="Resuming…">
              Resume
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
