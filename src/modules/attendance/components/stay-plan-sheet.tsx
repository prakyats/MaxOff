"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ResultError } from "@/core/errors";
import { formatWallTime } from "@/core/time";
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

import { setStayPlan } from "../actions/hours";
import { firstName, planDay } from "../domain/stay-plans";

/** Who the sheet is for, and what it starts from (dates ISO, times `HH:MM`, IST). */
export type StayPlanTarget = {
  memberId: string;
  name: string;
  /** `org_settings.work_end_time`: Stay until must be after it. */
  workEnd: string;
  /** Today (IST): the earliest day. */
  today: string;
  /** Change: the plan's day and time; null for a new one. */
  workDate: string | null;
  until: string | null;
};

/**
 * "Asha stays until…" (v7.0; the approved sample `docs/design/v70-clear-late-sample.html` screen
 * 5; WORKFLOWS §1 "Stay until ahead of time"): the Owner picks a day, today or later, and a time
 * after the end time; **Set Stay until** saves it and the person is told at once. A day of
 * approved leave is refused by the database, in its own words. One layer, a bottom sheet on a
 * phone (ARCHITECTURE §14.2 a): back, the backdrop and Cancel close it and send nothing.
 */
export function StayPlanSheet({
  target,
  onOpenChange,
}: {
  target: StayPlanTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent data-slot="stay-plan-sheet">
        {target ? (
          <PlanForm
            key={`${target.memberId}-${target.workDate ?? "new"}`}
            target={target}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PlanForm({ target, onClose }: { target: StayPlanTarget; onClose: () => void }) {
  const router = useRouter();
  const [workDate, setWorkDate] = useState(target.workDate ?? target.today);
  const [until, setUntil] = useState(target.until ?? laterBy(target.workEnd, 120));
  const [error, setError] = useState<ResultError | null>(null);
  const first = firstName(target.name);
  const action = useAction(async () => {
    const result = await setStayPlan({ memberId: target.memberId, workDate, until });
    if (
      toastResult(result, {
        success: `${first} was asked to stay until ${safeWords(until)} on ${safeDay(workDate)}`,
      })
    ) {
      onClose();
      router.refresh();
    } else if (!result.ok) {
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
        <DialogTitle>{first} stays until…</DialogTitle>
        <DialogDescription>
          {first} is told now. Their end time that day moves to {safeWords(until)}.
        </DialogDescription>
      </DialogHeader>
      {summary ? (
        <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
      ) : null}
      <FormField label="Day" hint="Today or a later day." error={error?.fieldErrors?.workDate}>
        {(control) => (
          <DateInput
            {...control}
            name="workDate"
            value={workDate}
            min={target.today}
            onChange={(event) => {
              setWorkDate(event.target.value);
              setError(null);
            }}
            className="max-w-48"
            required
          />
        )}
      </FormField>
      <FormField
        label="Until"
        hint={`After ${formatWallTime(target.workEnd)}.`}
        error={error?.fieldErrors?.until}
      >
        {(control) => (
          <TimeInput
            {...control}
            name="until"
            value={until}
            onChange={(event) => {
              setUntil(event.target.value);
              setError(null);
            }}
            className="max-w-40"
            required
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
          pendingLabel="Saving…"
          data-slot="stay-plan-set"
        >
          Set Stay until
        </Button>
      </DialogFooter>
    </form>
  );
}

/** "8:00 pm" for a typed `HH:MM`; the bare value while it is half typed. */
function safeWords(time: string): string {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? formatWallTime(time) : time;
}

/** "Fri 28 Nov" for a chosen ISO date; the bare value otherwise. */
function safeDay(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? planDay(date) : date;
}

/** `HH:MM` plus `minutes`, held to 23:30 (the sheet starts two hours after the end time). */
function laterBy(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min((h ?? 18) * 60 + (m ?? 0) + minutes, 23 * 60 + 30);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
