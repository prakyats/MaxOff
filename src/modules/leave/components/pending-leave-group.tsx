"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ApprovalGroup } from "@/core/ui/composites/approval-group";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { ReviewFacts, ReviewSheet } from "@/core/ui/composites/review-sheet";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { postKeepalive } from "@/core/ui/keepalive";

import { approveLeaves, rejectLeave } from "../actions/review";
import { LEAVE_TYPE_LABELS, leaveDates } from "../domain/requests";
import {
  approvedLeaveLabel,
  changeOfGoneLeave,
  firstName,
  keptDatesNote,
  type PendingLeave,
  pendingLeaveStatus,
  pendingLeaveSubtitle,
  pendingLeaveTitle,
} from "../domain/review";

/** The route behind the delayed send (`app/api/approvals/approve`): it outlives the page. */
const APPROVE_URL = "/api/approvals/approve";

/**
 * The Leave group of Approvals (task 2.4): requests waiting for the Owner, oldest first. Approve
 * is instant with Undo, and the days that keep an earlier decision are named once the approval
 * is recorded. Review opens the request in a sheet whose one action is Reject (a reason the
 * member will read); the dialog is held here, beside the sheet, so back closes it first
 * (ARCHITECTURE §14.2 a). A clash with leave already approved comes back on the row with the
 * message naming it; the sheet links to the person's leave, where the Owner cancels or edits it.
 */
export function PendingLeaveGroup({ requests }: { requests: PendingLeave[] }) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const review = requests.find((request) => request.id === reviewId) ?? null;
  const rejecting = requests.find((request) => request.id === rejectId) ?? null;

  return (
    <>
      <ApprovalGroup
        id="leave"
        heading="Leave"
        noun={{ one: "request", other: "requests" }}
        rows={requests.map((request) => ({
          id: request.id,
          title: pendingLeaveTitle(request),
          subtitle: pendingLeaveSubtitle(request),
          status: "submitted",
          statusLabel: pendingLeaveStatus(request),
          approvedLabel: approvedLeaveLabel(request, firstName(request.memberName)),
        }))}
        approve={(requestId) =>
          postKeepalive<{ keptDates: string[] }>(APPROVE_URL, { kind: "leave", id: requestId })
        }
        approveAll={(requestIds) => approveLeaves({ requestIds })}
        onApproved={(_, data) => {
          const note = keptDatesNote(data.keptDates);
          if (note) toast.info(note);
        }}
        onReview={setReviewId}
      />
      <ReviewSheet
        open={review !== null}
        onOpenChange={(open) => (open ? null : setReviewId(null))}
        title={review ? pendingLeaveTitle(review) : ""}
        description={review?.memberName}
        actions={
          review ? (
            <>
              <Button variant="ghost" asChild>
                <OverlayLink href={`/people/${review.memberId}`}>
                  {firstName(review.memberName)}&apos;s leave
                </OverlayLink>
              </Button>
              <Button variant="outline" onClick={() => setRejectId(review.id)}>
                Reject…
              </Button>
            </>
          ) : null
        }
      >
        {review ? (
          <div className="flex flex-col gap-4">
            <ReviewFacts
              facts={[
                { label: "Dates", value: leaveDates(review.startDate, review.endDate) },
                ...(review.original
                  ? [
                      {
                        label: review.requestsCancellation ? "Cancels" : "Changes",
                        value: `${LEAVE_TYPE_LABELS[review.original.type]} on ${leaveDates(review.original.startDate, review.original.endDate)}`,
                      },
                    ]
                  : []),
                ...(review.reason ? [{ label: "Their reason", value: review.reason }] : []),
              ]}
            />
            {changeOfGoneLeave(review) ? (
              <p data-slot="leave-gone-note" className="text-muted-foreground">
                The original was cancelled; this is approved as a new leave.
              </p>
            ) : null}
          </div>
        ) : null}
      </ReviewSheet>
      <ReasonDialog
        open={rejecting !== null}
        onOpenChange={(open) => (open ? null : setRejectId(null))}
        title={rejecting ? `Reject ${firstName(rejecting.memberName)}'s request?` : "Reject"}
        description={
          rejecting
            ? `${pendingLeaveTitle(rejecting)} on ${leaveDates(rejecting.startDate, rejecting.endDate)}. ${rejecting.memberName} will see this reason.`
            : undefined
        }
        label="Reason"
        placeholder={`${rejecting?.memberName ?? "They"} will see this reason.`}
        submitLabel="Reject"
        destructive
        onSubmit={async (reason) => {
          if (!rejecting) return;
          const done = toastResult(await rejectLeave({ requestId: rejecting.id, reason }), {
            success: "Request rejected",
          });
          if (done) setReviewId(null);
          return done;
        }}
      />
    </>
  );
}
