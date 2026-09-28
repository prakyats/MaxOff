"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { bulkSummary } from "@/core/errors/bulk";
import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import {
  CARD_ROW_MIN_H,
  CARD_ROW_PADDING,
  CARD_ROW_TITLE,
  CARD_ROW_TRAILING,
} from "@/core/ui/composites/row-metrics";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import { Label } from "@/core/ui/primitives/label";
import { toast } from "sonner";

import { markExpenseClaimsPaid } from "../actions/claims";
import {
  claimOutcome,
  claimsLabel,
  claimTitle,
  type ExpenseClaim,
  formatRupees,
  unpaidTotal,
} from "../domain/claims";

/**
 * A person's claims dated in the month, for the Owner (the Expenses part of `/people/[id]/month`,
 * 3b.3 / 3b.4): the approved-and-unpaid total first (what to add to the salary), then each claim
 * with where it stands. **Mark paid** on one approved claim, or **Mark all paid** for the month's
 * approved claims at once, on a date (default today). Decisions themselves are made in Approvals.
 */
export function MemberMonthClaims({
  claims,
  today,
  personName,
}: {
  claims: ExpenseClaim[];
  today: string;
  personName: string;
}) {
  const router = useRouter();
  const id = useId();
  const [target, setTarget] = useState<ExpenseClaim[] | null>(null);
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const unpaid = unpaidTotal(claims);
  const approved = claims.filter((claim) => claim.state === "approved");

  function open(list: ExpenseClaim[]) {
    setPaidOn(today);
    setError(null);
    setTarget(list);
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      data-slot="month-claims"
      className="flex flex-col gap-3"
    >
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 id={`${id}-heading`} className="text-sm font-medium">
            Expenses
          </h2>
          <p className="text-muted-foreground text-sm tabular-nums" data-slot="unpaid-total">
            {unpaid.count > 0
              ? `Approved, not paid: ${formatRupees(unpaid.total)} · ${claimsLabel(unpaid.count)}`
              : "Nothing approved and unpaid"}
          </p>
        </div>
        {approved.length > 1 ? (
          <Button variant="secondary" onClick={() => open(approved)}>
            Mark all paid
          </Button>
        ) : null}
      </div>
      {claims.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-3 text-sm">
          No claims dated this month.
        </p>
      ) : (
        <ul className="border-border divide-border bg-card divide-y rounded-lg border">
          {claims.map((claim) => {
            const outcome = claimOutcome(claim);
            return (
              <li
                key={claim.id}
                data-slot="month-claim"
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
                {claim.state === "approved" ? (
                  <div className="flex w-full justify-end">
                    <Button variant="secondary" size="sm" onClick={() => open([claim])}>
                      Mark paid
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => (next ? null : setTarget(null))}
        title={
          target && target.length > 1
            ? `Mark ${target.length} claims paid?`
            : "Mark this claim paid?"
        }
        description={
          target
            ? `${formatRupees(unpaidTotal(target).total)} to ${personName}. Paid claims stay in their history.`
            : undefined
        }
        confirmLabel={target && target.length > 1 ? `Mark ${target.length} paid` : "Mark paid"}
        onConfirm={async () => {
          if (!target) return;
          if (!paidOn || paidOn > today) {
            setError("Pick a payment date up to today.");
            return false;
          }
          const result = await markExpenseClaimsPaid({
            claimIds: target.map((claim) => claim.id),
            paidOn,
          });
          if (!result.ok) {
            setError(result.error.message);
            return false;
          }
          const failed = result.data.failed[0];
          if (failed) {
            setError(failed.message);
            router.refresh();
            return false;
          }
          toast.success(bulkSummary(result.data, "marked paid"));
          router.refresh();
          return true;
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-paid-on`}>Paid on</Label>
          <Input
            id={`${id}-paid-on`}
            type="date"
            max={today}
            value={paidOn}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setPaidOn(event.target.value);
              setError(null);
            }}
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
        </div>
      </ConfirmDialog>
    </section>
  );
}
