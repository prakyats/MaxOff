"use client";

import { ReceiptIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import {
  CARD_ROW_MIN_H,
  CARD_ROW_PADDING,
  CARD_ROW_TITLE,
  CARD_ROW_TRAILING,
} from "@/core/ui/composites/row-metrics";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { withdrawExpenseClaim } from "../actions/claims";
import {
  claimActions,
  claimOutcome,
  claimTitle,
  type ExpenseClaim,
  formatRupees,
} from "../domain/claims";

/**
 * The member's own claims, newest expense first (Attendance & leave → Expenses, 3b.3): what and
 * when, the amount, the note, and where it stands in their words ("Waiting for the Owner",
 * "Approved · not paid yet", "Paid on 3 Oct 2026", "Rejected" with the Owner's reason).
 * **Withdraw** while it waits, with a named confirmation. Cards at every width.
 */
export function OwnClaimsList({ claims }: { claims: ExpenseClaim[] }) {
  const router = useRouter();
  const [withdrawing, setWithdrawing] = useState<ExpenseClaim | null>(null);

  if (claims.length === 0) {
    return (
      <EmptyState
        icon={ReceiptIcon}
        title="No expense claims yet"
        description="Spent your own money on work? Add it here or when you end your day, and the Owner pays it back."
      />
    );
  }
  return (
    <>
      <ul
        data-slot="expense-claims"
        className="border-border divide-border bg-card divide-y rounded-lg border"
      >
        {claims.map((claim) => {
          const outcome = claimOutcome(claim);
          return (
            <li
              key={claim.id}
              data-slot="expense-claim"
              data-state={claim.state}
              className={cn(
                "flex flex-wrap items-start gap-x-3 gap-y-1",
                CARD_ROW_MIN_H,
                CARD_ROW_PADDING,
              )}
            >
              <div className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
                <span className="font-medium">{claimTitle(claim)}</span>
                <span className="text-muted-foreground text-sm break-words">{claim.note}</span>
              </div>
              <div className={cn("flex flex-col items-end gap-0.5", CARD_ROW_TRAILING)}>
                <span className="font-medium tabular-nums">{formatRupees(claim.amount)}</span>
                <StatusDot status={outcome.status} label={outcome.text} className="text-sm" />
              </div>
              {claim.state === "rejected" && claim.decisionReason ? (
                <p className="text-muted-foreground w-full text-sm break-words">
                  The Owner: {claim.decisionReason}
                </p>
              ) : null}
              {claimActions(claim).withdraw ? (
                <div className="flex w-full justify-end">
                  <Button variant="destructive" size="sm" onClick={() => setWithdrawing(claim)}>
                    Withdraw
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(open) => (open ? null : setWithdrawing(null))}
        title="Withdraw this claim?"
        description={
          withdrawing
            ? `${formatRupees(withdrawing.amount)} · ${claimTitle(withdrawing)}. The Owner won't see it any more. You can add it again.`
            : undefined
        }
        confirmLabel="Withdraw claim"
        onConfirm={async () => {
          if (!withdrawing) return;
          const result = await withdrawExpenseClaim({ claimId: withdrawing.id });
          if (toastResult(result, { success: "Claim withdrawn" })) router.refresh();
        }}
      />
    </>
  );
}
