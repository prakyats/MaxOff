"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { fileUrl } from "@/core/storage";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { FileImage } from "@/core/storage/components/file-image";
import { ApprovalGroup, type ApprovalWaiting } from "@/core/ui/composites/approval-group";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { ReviewFacts, ReviewSheet } from "@/core/ui/composites/review-sheet";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";
import { displayName } from "@/core/lib/display-name";

import { approveExpenseClaim, rejectExpenseClaim } from "../actions/claims";
import { claimDate, claimDetail, type ExpenseClaim, formatRupees } from "../domain/claims";

export type PendingClaim = ExpenseClaim & { memberName: string };

/**
 * The Expenses group of Approvals (PRODUCT §4.18, 3b.3; kickoff 3b decision 29: after Extra
 * work): every claim waiting for the Owner, oldest first. **Review-only**: money deserves a look
 * at the note and the receipt, so Review opens the claim in a sheet with **Approve** and
 * **Reject…** (a reason the person reads). The reject dialog is held here, beside the sheet, so
 * back closes it first (ARCHITECTURE §14.2 a). Only `expenses.decide` ever gets this list.
 */
export function PendingClaimsGroup({
  claims,
  preview = false,
  waiting,
}: {
  claims: PendingClaim[];
  /**
   * The Owner's Today: compact rows for its one list (kind, name, detail, how long it waited),
   * each with Review alone, as here: a claim is approved in its review (owner 2026-10-09).
   */
  preview?: boolean;
  /** Each claim's waiting words on the Owner's Today, worked out on the server. */
  waiting?: Readonly<Record<string, ApprovalWaiting>>;
}) {
  const router = useRouter();
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const approve = useAction(
    async (claimId: string) => {
      const result = await approveExpenseClaim({ claimId });
      if (toastResult(result, { success: "Claim approved" })) {
        // Only the sheet of the claim it approved (the sheet cannot change while it runs, below).
        setReviewId((current) => (current === claimId ? null : current));
        router.refresh();
      }
    },
    { resetKey: reviewId },
  );
  const approving = approve.pending;
  const review = claims.find((claim) => claim.id === reviewId) ?? null;
  const rejecting = claims.find((claim) => claim.id === rejectId) ?? null;

  return (
    <>
      <ApprovalGroup
        id="expenses"
        heading="Expenses"
        noun={{ one: "claim", other: "claims" }}
        rows={claims.map((claim) => ({
          id: claim.id,
          title: claim.memberName,
          // A compact row has no status word of its own: a missing receipt joins its first meta
          // line ("₹385 · Food · Thu 8 Oct · No receipt").
          subtitle: preview
            ? claimDetail(claim)
            : `${formatRupees(claim.amount)} · ${claim.categoryName} · ${claimDate(claim.expenseDate)}`,
          status: "submitted",
          statusLabel: claim.receiptFileId ? "Receipt" : "No receipt",
          approvedLabel: "",
          waiting: waiting?.[claim.id],
        }))}
        onReview={setReviewId}
        layout={preview ? "rows" : "group"}
        kind="Expense"
      />
      <ReviewSheet
        open={review !== null}
        // Held open while its Approve is on its way, as a confirmation is: another claim opened
        // meanwhile would show this one's pending state and outcome (v1.0.0 review).
        onOpenChange={(open) => (open || approving ? null : setReviewId(null))}
        title={review?.memberName ?? ""}
        description={review ? `${formatRupees(review.amount)} · ${review.categoryName}` : undefined}
        actions={
          review ? (
            <>
              <Button
                variant="destructive"
                disabled={approving}
                onClick={() => setRejectId(review.id)}
              >
                Reject…
              </Button>
              <Button
                variant="primary"
                pending={approving}
                pendingLabel="Approving…"
                onClick={() => approve.run(review.id)}
              >
                Approve
              </Button>
            </>
          ) : null
        }
      >
        {review ? (
          <div className="flex flex-col gap-4">
            <ReviewFacts
              facts={[
                { label: "Spent on", value: claimDate(review.expenseDate) },
                { label: "Amount", value: formatRupees(review.amount) },
                { label: "Category", value: review.categoryName },
                { label: `${displayName(review.memberName)} says`, value: review.note },
              ]}
            />
            {review.receiptFileId ? (
              <a
                href={fileUrl(review.receiptFileId, "original")}
                target="_blank"
                rel="noreferrer"
                data-slot="receipt-link"
                className="pressable-row focus-visible:ring-ring self-start rounded-lg outline-none focus-visible:ring-2"
              >
                <FileImage
                  fileId={review.receiptFileId}
                  alt={`${displayName(review.memberName)}'s receipt`}
                  className="border-border max-h-64 w-auto max-w-full rounded-lg border"
                />
                <span className="text-muted-foreground mt-1 block text-xs">
                  Tap to open the full photo
                </span>
              </a>
            ) : (
              <p className="text-muted-foreground text-sm">No receipt photo.</p>
            )}
            <ActionStatus action={approve} />
          </div>
        ) : null}
      </ReviewSheet>
      <ReasonDialog
        open={rejecting !== null}
        onOpenChange={(open) => (open ? null : setRejectId(null))}
        title={rejecting ? `Reject ${displayName(rejecting.memberName)}'s claim?` : "Reject"}
        description={
          rejecting
            ? `${formatRupees(rejecting.amount)} · ${rejecting.categoryName}. ${rejecting.memberName} will see this reason.`
            : undefined
        }
        label="Reason"
        placeholder="Not a work expense."
        submitLabel="Reject claim"
        destructive
        onSubmit={async (reason) => {
          if (!rejecting) return;
          const result = await rejectExpenseClaim({ claimId: rejecting.id, reason });
          if (!toastResult(result, { success: "Claim rejected" })) return false;
          setReviewId(null);
          router.refresh();
        }}
      />
    </>
  );
}
