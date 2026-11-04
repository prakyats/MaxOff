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
import { TimeInput } from "@/core/ui/primitives/date-time-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { describeError, toastResult } from "@/core/ui/toast";

import { setStayUntil } from "../actions/hours";

/** Who the sheet is for, and the times it starts from (`HH:MM`, IST). */
export type StayUntilTarget = {
  memberId: string;
  name: string;
  /** `org_settings.work_end_time`: Stay until must be after it. */
  workEnd: string;
  /** Today's Stay until, when one is set. */
  current: string | null;
};

/**
 * "Stay until" (v1.9 W4; the working-hours sample §3; WORKFLOWS §1: the Owner only): a time later
 * today, after the end time; the person is told at once. **Set ‹time›** saves it; the outline
 * button keeps the end time as it is, or, once a Stay until is set, takes it away ("Back to
 * 6:00 pm"). One layer, a bottom sheet on a phone (§14.2 a).
 */
export function StayUntilSheet({
  target,
  onOpenChange,
}: {
  target: StayUntilTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent data-slot="stay-until-sheet">
        {target ? (
          <StayForm key={target.memberId} target={target} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StayForm({ target, onClose }: { target: StayUntilTarget; onClose: () => void }) {
  const router = useRouter();
  const [until, setUntil] = useState(target.current ?? laterBy(target.workEnd, 120));
  const [error, setError] = useState<ResultError | null>(null);
  const endWords = formatWallTime(target.workEnd);
  const action = useAction(async (clear: boolean) => {
    const result = await setStayUntil({
      memberId: target.memberId,
      until: clear ? null : until,
    });
    if (
      toastResult(result, {
        success: clear
          ? `${target.name}'s day ends at ${endWords} again`
          : `${target.name} was asked to stay until ${safeWords(until)}`,
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
        action.run(false);
      }}
    >
      <DialogHeader>
        <DialogTitle>{target.name} · Stay until</DialogTitle>
        <DialogDescription>
          {target.current
            ? `Their day ends at ${safeWords(target.current)}. They'll be told right away.`
            : `Their day ends at ${endWords}. They'll be told right away.`}
        </DialogDescription>
      </DialogHeader>
      {summary ? (
        <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
      ) : null}
      <FormField
        label="Stay until"
        hint={`Later today, after ${endWords}.`}
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
        {target.current ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => action.run(true)}
            data-slot="stay-until-clear"
          >
            Back to {endWords}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={pending}
            data-dismiss=""
          >
            Keep {endWords}
          </Button>
        )}
        <Button
          variant="primary"
          type="submit"
          pending={pending}
          pendingLabel="Saving…"
          data-slot="stay-until-set"
        >
          Set {safeWords(until)}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** "8:00 pm" for a typed `HH:MM`; the bare value while it is half typed. */
function safeWords(time: string): string {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? formatWallTime(time) : time;
}

/** `HH:MM` plus `minutes`, held to 23:30 (the sheet starts two hours after the end time). */
function laterBy(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min((h ?? 18) * 60 + (m ?? 0) + minutes, 23 * 60 + 30);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
