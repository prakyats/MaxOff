"use client";

import { useState } from "react";
import { toast } from "sonner";

import type { ResultError } from "@/core/errors";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
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
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError } from "@/core/ui/toast";

import { closeMonth, correctMonth } from "../actions/month-close";
import { CORRECTION_NOTE_MAX_LENGTH, CORRECTION_NOTE_MIN_LENGTH } from "../domain/month-close";
import { type ChangeRow, noteProblem } from "../domain/month-close-view";

import { ChangeList } from "./month-close-changes";

/** A refusal said inside the layer: the function's own words ("Nothing changed."). */
function alertOf(error: ResultError | null): string | null {
  if (!error) return null;
  const summary = describeError(error);
  return summary.description ?? summary.title;
}

/**
 * Close a month (v3.5 U4; WORKFLOWS §7.4 `month_close`): the confirmation the close screen's
 * button opens. A bottom sheet on a phone, a dialog on a laptop; one neutral solid commit, named
 * for what it does ("Close September"), and Cancel beside it (ADR-0015). What is still waiting is
 * said once more, and that it does not stop the close. The function's refusal ("… is already
 * closed.", from another tab) is said here and the sheet stays.
 */
export function CloseMonthDialog({
  month,
  monthName,
  waiting,
  confirmLabel,
  onClose,
}: {
  month: string;
  monthName: string;
  waiting: number;
  confirmLabel: string;
  onClose: () => void;
}) {
  const [error, setError] = useState<ResultError | null>(null);
  const action = useAction(async () => {
    setError(null);
    const result = await closeMonth({ month });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`${monthName} closed · v${result.data.version}`);
    onClose();
  });
  const alert = alertOf(error);
  return (
    <Dialog open onOpenChange={(open) => (open || action.pending ? undefined : onClose())}>
      <DialogContent data-slot="month-close-dialog">
        <form
          noValidate
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            action.run();
          }}
        >
          <DialogHeader>
            <DialogTitle>Close {monthName}?</DialogTitle>
            <DialogDescription>
              {monthName}&apos;s revenue report is saved as it is now, as version 1, and stays as
              saved. Work and amounts stay editable; what moves later shows under Changed since
              close.
            </DialogDescription>
          </DialogHeader>
          {waiting > 0 ? (
            <p className="text-sm" data-slot="month-close-dialog-waiting">
              {waiting === 1 ? "1 thing is" : `${waiting} things are`} still waiting. Closing
              doesn&apos;t settle {waiting === 1 ? "it" : "them"}: you can still do that afterwards.
            </p>
          ) : null}
          {alert ? <ErrorText slot="form-alert">{alert}</ErrorText> : null}
          <ActionStatus action={action} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={action.pending}
              data-dismiss=""
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              pending={action.pending}
              pendingLabel={`Closing ${monthName}…`}
              data-slot="month-close-confirm"
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Correct a closed month (v3.5 U4; WORKFLOWS §7.4 `month_correct`): the differences since the
 * close and the required note (10 to 500 characters, said by the field). The commit saves today's
 * data as the next version; every earlier version stays. "Nothing changed." (the function's
 * refusal when the rebuild equals the latest version) is said here and nothing is saved.
 */
export function CorrectMonthDialog({
  month,
  monthName,
  nextVersion,
  changes,
  totals,
  onClose,
}: {
  month: string;
  monthName: string;
  nextVersion: number;
  changes: readonly ChangeRow[];
  totals: readonly { key: string; text: string }[];
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [field, setField] = useState<string | null>(null);
  const [error, setError] = useState<ResultError | null>(null);
  // The note is read when the action runs, so a Retry sends the corrected one.
  const action = useAction(async () => {
    const problem = noteProblem(note);
    if (problem) {
      setField(problem);
      return;
    }
    setError(null);
    const result = await correctMonth({ month, note });
    if (!result.ok) {
      const refused = result.error.fieldErrors?.note?.[0];
      if (refused) setField(refused);
      else setError(result.error);
      return;
    }
    toast.success(`${monthName} corrected · v${result.data.version}`);
    onClose();
  });
  const alert = alertOf(error);
  const unchanged = changes.length === 0 && totals.length === 0;
  return (
    <Dialog open onOpenChange={(open) => (open || action.pending ? undefined : onClose())}>
      <DialogContent data-slot="month-correct-dialog">
        <form
          noValidate
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            const problem = noteProblem(note);
            setField(problem);
            if (!problem) action.run();
          }}
        >
          <DialogHeader>
            <DialogTitle>Correct {monthName}</DialogTitle>
            <DialogDescription>
              {monthName} is rebuilt from today&apos;s data and saved as version {nextVersion}.
              Every earlier version stays as it was.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2" data-slot="month-correct-differences">
            <p className="text-sm font-medium">
              {unchanged ? "No revenue line has moved" : "What moved since the close"}
            </p>
            {unchanged ? (
              <p className="text-muted-foreground text-sm">
                Expense totals and the month summary are compared too; if nothing differs at all,
                nothing is saved.
              </p>
            ) : (
              <ChangeList changes={changes} totals={totals} />
            )}
          </div>
          <FormField
            label="Why you're correcting it"
            error={field ?? undefined}
            hint={`${CORRECTION_NOTE_MIN_LENGTH} to ${CORRECTION_NOTE_MAX_LENGTH} characters. Saved with version ${nextVersion}; only you see it.`}
          >
            {(control) => (
              <Textarea
                {...control}
                name="note"
                rows={3}
                maxLength={CORRECTION_NOTE_MAX_LENGTH + 50}
                placeholder="e.g. Reel 3 was reopened after the close."
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  if (field) setField(null);
                  if (error) setError(null);
                }}
              />
            )}
          </FormField>
          {alert ? <ErrorText slot="form-alert">{alert}</ErrorText> : null}
          <ActionStatus action={action} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={action.pending}
              data-dismiss=""
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              pending={action.pending}
              pendingLabel={`Correcting ${monthName}…`}
              data-slot="month-correct-confirm"
            >
              Save version {nextVersion}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
