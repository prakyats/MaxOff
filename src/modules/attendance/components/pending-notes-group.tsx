"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import type { ResultError } from "@/core/errors";
import { cn } from "@/core/lib/utils";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ApprovalGroup } from "@/core/ui/composites/approval-group";
import { ErrorText } from "@/core/ui/composites/error-text";
import { ReviewFacts, ReviewSheet } from "@/core/ui/composites/review-sheet";
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
import { Textarea } from "@/core/ui/primitives/textarea";
import { toastResult } from "@/core/ui/toast";

import { decideExtraWorkNote } from "../actions/notes";
import { firstName, historyDate } from "../domain/history";
import { ATTENDANCE_REASON_MAX_LENGTH } from "../domain/limits";
import {
  durationLabel,
  type ExtraWorkNote,
  KIND_LABELS,
  NOTE_DECISION_LABELS,
  NOTE_DECISIONS,
  type NoteDecision,
  noteTitle,
} from "../domain/notes";

export type PendingNote = ExtraWorkNote & { memberName: string };

/**
 * The Extra work group of Approvals (PRODUCT §4.3a, 3b.2; kickoff 3b decision 29: after Leave):
 * every note waiting for the Owner, oldest first. Every decision needs thought, so the group is
 * review-only: Review opens the note in a sheet whose one action is **Decide…** (grant ½ or 1 day
 * of comp leave, or no comp leave; for a day off, whether the day counts as worked). The dialog is
 * held here, beside the sheet, so back closes it first (ARCHITECTURE §14.2 a).
 */
export function PendingNotesGroup({ notes }: { notes: PendingNote[] }) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [decideId, setDecideId] = useState<string | null>(null);
  const review = notes.find((note) => note.id === reviewId) ?? null;
  const deciding = notes.find((note) => note.id === decideId) ?? null;

  return (
    <>
      <ApprovalGroup
        id="extra-work"
        heading="Extra work"
        noun={{ one: "note", other: "notes" }}
        rows={notes.map((note) => ({
          id: note.id,
          title: note.memberName,
          subtitle: noteTitle(note),
          status: "submitted",
          statusLabel: note.kind === "day_off" ? "Day off worked" : "Overtime",
          approvedLabel: "",
        }))}
        onReview={setReviewId}
      />
      <ReviewSheet
        open={review !== null}
        onOpenChange={(open) => (open ? null : setReviewId(null))}
        title={review?.memberName ?? ""}
        description={review ? noteTitle(review) : undefined}
        actions={
          review ? (
            <Button variant="strong" onClick={() => setDecideId(review.id)}>
              Decide…
            </Button>
          ) : null
        }
      >
        {review ? (
          <ReviewFacts
            facts={[
              {
                label: "Day",
                value: `${historyDate(review.workDate)} · ${KIND_LABELS[review.kind]}`,
              },
              ...(review.durationMinutes
                ? [{ label: "Roughly", value: durationLabel(review.durationMinutes) }]
                : []),
              { label: `${firstName(review.memberName)} worked on`, value: review.note },
            ]}
          />
        ) : null}
      </ReviewSheet>
      <DecideNoteDialog
        note={deciding}
        onOpenChange={(open) => (open ? null : setDecideId(null))}
        onDecided={() => setReviewId(null)}
      />
    </>
  );
}

/** Grant ½ or 1 day, or no comp leave; a day off may also be counted as worked. Nothing is automatic. */
function DecideNoteDialog({
  note,
  onOpenChange,
  onDecided,
}: {
  note: PendingNote | null;
  onOpenChange: (open: boolean) => void;
  onDecided: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [decision, setDecision] = useState<NoteDecision | null>(null);
  const [markWorked, setMarkWorked] = useState(false);
  const [ownerNote, setOwnerNote] = useState("");
  const [error, setError] = useState<ResultError | null>(null);
  // The note on screen, read when it runs (a Retry sends what is shown now), and a failure
  // belongs to its note: opening another forgets it (v1.0.0 review).
  const action = useAction(
    async () => {
      if (!note) return;
      const result = await decideExtraWorkNote({
        noteId: note.id,
        decision: (decision ?? "") as NoteDecision,
        markDayWorked: note.kind === "day_off" && markWorked,
        note: ownerNote,
      });
      if (
        toastResult(result, {
          success: decision === "no_comp_leave" ? "Reviewed, no comp leave" : "Comp leave granted",
        })
      ) {
        onDecided();
        // Closed directly: `close` refuses while the action is still pending, which it is here.
        reset();
        onOpenChange(false);
        router.refresh();
      } else if (!result.ok) {
        setError(result.error);
      }
    },
    { resetKey: note?.id ?? null },
  );
  const { pending } = action;

  function reset() {
    setDecision(null);
    setMarkWorked(false);
    setOwnerNote("");
    setError(null);
  }

  function close(open: boolean) {
    if (pending) return;
    if (!open) reset();
    onOpenChange(open);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note) return;
    action.run();
  }

  const decisionError = error?.fieldErrors?.decision?.[0];
  return (
    <Dialog open={note !== null} onOpenChange={close}>
      <DialogContent data-slot="decide-note-dialog">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {note
                ? `${firstName(note.memberName)}'s ${KIND_LABELS[note.kind].toLowerCase()}`
                : "Decide"}
            </DialogTitle>
            <DialogDescription>
              {note ? `${historyDate(note.workDate)}. ` : ""}A credit expires at the end of this
              month. {note?.memberName ?? "They"} will see the outcome on their note.
            </DialogDescription>
          </DialogHeader>
          {error && !error.fieldErrors ? (
            <ErrorText slot="form-alert">{error.message}</ErrorText>
          ) : null}
          <fieldset className="flex flex-col gap-2" aria-invalid={decisionError ? true : undefined}>
            <legend className="mb-1 text-sm font-medium">Comp leave</legend>
            {NOTE_DECISIONS.map((option) => (
              <label
                key={option}
                data-slot="decision-option"
                className={cn(
                  "border-border bg-card flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2",
                  "has-[:checked]:border-strong has-[:checked]:bg-strong/5 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3",
                )}
              >
                <input
                  type="radio"
                  name="decision"
                  value={option}
                  checked={decision === option}
                  onChange={() => {
                    setDecision(option);
                    setError(null);
                  }}
                  className="accent-strong size-5 shrink-0"
                />
                <span className="font-medium">{NOTE_DECISION_LABELS[option]}</span>
              </label>
            ))}
            {decisionError ? <ErrorText alert={false}>{decisionError}</ErrorText> : null}
          </fieldset>
          {note?.kind === "day_off" ? (
            <div className="flex items-start gap-3">
              <Checkbox
                id={`${id}-worked`}
                checked={markWorked}
                onCheckedChange={(checked) => setMarkWorked(checked === true)}
              />
              <Label htmlFor={`${id}-worked`} className="leading-snug">
                Count {historyDate(note.workDate)} as a day worked (a day off worked)
              </Label>
            </div>
          ) : null}
          {decision && decision !== "no_comp_leave" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-note`}>A note for them (optional)</Label>
              <Textarea
                id={`${id}-note`}
                rows={2}
                maxLength={ATTENDANCE_REASON_MAX_LENGTH}
                placeholder="Thanks for the late night."
                value={ownerNote}
                onChange={(event) => setOwnerNote(event.target.value)}
              />
            </div>
          ) : null}
          <ActionStatus action={action} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => close(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={!decision}
              pending={pending}
              pendingLabel={
                decision === "no_comp_leave" ? "Marking reviewed…" : "Granting comp leave…"
              }
            >
              {decision === "no_comp_leave" ? "Mark reviewed" : "Grant comp leave"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
