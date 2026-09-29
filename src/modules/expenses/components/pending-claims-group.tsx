"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { fileUrl } from "@/core/storage";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { FileImage } from "@/core/storage/components/file-image";
import { ApprovalGroup } from "@/core/ui/composites/approval-group";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { ReviewFacts, ReviewSheet } from "@/core/ui/composites/review-sheet";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { approveExpenseClaim, rejectExpenseClaim } from "../actions/claims";
import { claimDate, type ExpenseClaim, formatRupees } from "../domain/claims";

export type PendingClaim = ExpenseClaim & { memberName: string };

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * The Expenses group of Approvals (PRODUCT §4.18, 3b.3; kickoff 3b decision 29: after Extra
 * work): every claim waiting for the Owner, oldest first. **Review-only**: money deserves a look
 * at the note and the receipt, so Review opens the claim in a sheet with **Approve** and
 * **Reject…** (a reason the person reads). The reject dialog is held here, beside the sheet, so
 * back closes it first (ARCHITECTURE §14.2 a). Only `expenses.decide` ever gets this list.
 */
export function PendingClaimsGroup({ claims }: { claims: PendingClaim[] }) {
  const router = useRouter();
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const approve = useAction(
    async (claimId: string) => {
      const result = await approveExpenseClaim({ claimId });
      if (toastResult(result, { success: "Claim approved" })) {
        setReviewId(null);
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
          subtitle: `${formatRupees(claim.amount)} · ${claim.categoryName} · ${claimDate(claim.expenseDate)}`,
          status: "submitted",
          statusLabel: claim.receiptFileId ? "Receipt" : "No receipt",
          approvedLabel: "",
        }))}
        onReview={setReviewId}
      />
      <ReviewSheet
        open={review !== null}
        onOpenChange={(open) => (open ? null : setReviewId(null))}
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
                { label: `${firstName(review.memberName)} says`, value: review.note },
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
                  alt={`${firstName(review.memberName)}'s receipt`}
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
        title={rejecting ? `Reject ${firstName(rejecting.memberName)}'s claim?` : "Reject"}
        description={
          rejecting
            ? `${formatRupees(rejecting.amount)} · ${rejecting.categoryName}. ${rejecting.memberName} will see this reason.`
            : undefined
        }
        label="Reason"
        placeholder="Not a work expense."
        submitLabel="Reject claim"
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
