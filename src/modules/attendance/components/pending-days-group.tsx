"use client";

import { useState } from "react";

import { ApprovalGroup } from "@/core/ui/composites/approval-group";
import { ReviewFacts, ReviewSheet } from "@/core/ui/composites/review-sheet";
import { Button } from "@/core/ui/primitives/button";

import { postKeepalive } from "@/core/ui/keepalive";

import { approveDays } from "../actions/review";
import { firstName, historyDate, clockTime } from "../domain/history";
import {
  approvedLabel,
  pendingLabel,
  pendingOutcome,
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
export function PendingDaysGroup({ days, today }: { days: PendingDay[]; today: string }) {
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
          subtitle: pendingSubtitle(day, today),
          status: "pending_review",
          statusLabel: pendingLabel(day),
          approvedLabel: approvedLabel(day),
        }))}
        approve={(dayId) => postKeepalive<null>(APPROVE_URL, { kind: "day", id: dayId })}
        approveAll={(dayIds) => approveDays({ dayIds })}
        onReview={setReviewId}
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
                  ? `${firstName(review.memberName)} chose`
                  : "Proposed",
                value: pendingLabel(review),
              },
              ...(review.note ? [{ label: "Their note", value: review.note }] : []),
              {
                label: "Signed in",
                value: review.firstLoginAt ? clockTime(review.firstLoginAt) : "Not recorded",
              },
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
