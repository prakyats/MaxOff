"use client";

import { useState } from "react";

import { ApprovalGroup, type ApprovalWaiting } from "@/core/ui/composites/approval-group";
import { ReviewFacts, ReviewSheet } from "@/core/ui/composites/review-sheet";
import { Button } from "@/core/ui/primitives/button";

import { postKeepalive } from "@/core/ui/keepalive";
import { displayName } from "@/core/lib/display-name";

import { approveDays } from "../actions/review";
import { historyDate } from "../domain/history";
import {
  approvedLabel,
  pendingDetail,
  pendingLabel,
  pendingOutcome,
  pendingStart,
  pendingSubtitle,
  type PendingDay,
} from "../domain/review";

import { CorrectDayDialog, type CorrectTarget } from "./correct-day-dialog";

/** The route behind the delayed send (`app/api/approvals/approve`): it outlives the page. */
const APPROVE_URL = "/api/approvals/approve";

/**
 * The Attendance group of Approvals (task 2.4): every day waiting for the Owner, oldest first.
 * Approve is instant with Undo; Review opens the day in a sheet whose one action is Correct
 * (status + a reason the member will read). The dialog is held here, beside the sheet, so the
 * sheet stays open under it and back closes them one at a time (ARCHITECTURE §14.2 a).
 */
export function PendingDaysGroup({
  days,
  today,
  preview = false,
  waiting,
}: {
  days: PendingDay[];
  today: string;
  /**
   * The Owner's Today: compact rows for its one list (kind, name, detail, how long it waited,
   * Approve with Undo; a tap opens Review), no heading and no Approve all (owner 2026-10-09).
   */
  preview?: boolean;
  /** Each day's waiting words on the Owner's Today, worked out on the server. */
  waiting?: Readonly<Record<string, ApprovalWaiting>>;
}) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [correct, setCorrect] = useState<CorrectTarget | null>(null);
  const review = days.find((day) => day.id === reviewId) ?? null;

  return (
    <>
      <ApprovalGroup
        id="attendance"
        heading="Attendance"
        noun={{ one: "day", other: "days" }}
        rows={days.map((day) => ({
          id: day.id,
          title: day.memberName,
          // A compact row's first meta line: what was chosen and when, never cut short.
          subtitle: preview ? pendingDetail(day, today) : pendingSubtitle(day, today),
          status: "pending_review",
          statusLabel: pendingLabel(day),
          approvedLabel: approvedLabel(day),
          waiting: waiting?.[day.id],
        }))}
        approve={(dayId) => postKeepalive<null>(APPROVE_URL, { kind: "day", id: dayId })}
        approveAll={preview ? undefined : (dayIds) => approveDays({ dayIds })}
        onReview={setReviewId}
        layout={preview ? "rows" : "group"}
        kind="Attendance"
      />
      <ReviewSheet
        open={review !== null}
        onOpenChange={(open) => (open ? null : setReviewId(null))}
        title={review ? `${review.memberName}` : ""}
        description={review ? historyDate(review.workDate) : undefined}
        actions={
          review ? (
            <Button
              variant="secondary"
              onClick={() =>
                setCorrect({
                  dayId: review.id,
                  memberName: review.memberName,
                  workDate: review.workDate,
                  current: pendingOutcome(review),
                  leaveType: null,
                  // Many members on one screen: the balance is not read here, so comp leave
                  // stays choosable and the database's refusal shows in the dialog (3c review).
                  compDays: null,
                })
              }
            >
              Correct…
            </Button>
          ) : null
        }
      >
        {review ? (
          <ReviewFacts
            facts={[
              {
                label: review.submittedChoice
                  ? `${displayName(review.memberName)} chose`
                  : "Proposed",
                value: pendingLabel(review),
              },
              ...(review.note ? [{ label: "Their note", value: review.note }] : []),
              pendingStart(review),
              ...(review.onApprovedLeave
                ? [{ label: "Leave", value: "Approved leave covers this day; it stays as it is" }]
                : []),
            ]}
          />
        ) : null}
      </ReviewSheet>
      <CorrectDayDialog
        target={correct}
        onOpenChange={(open) => (open ? null : setCorrect(null))}
        onCorrected={() => setReviewId(null)}
      />
    </>
  );
}
