"use server";

import { revalidatePath } from "next/cache";

import { action, type BulkOutcome, eachId, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/claims";
import {
  type ClaimIdInput,
  claimIdSchema,
  type MarkPaidInput,
  markPaidSchema,
  type ReceiptAboveInput,
  receiptAboveSchema,
  type RejectClaimInput,
  rejectClaimSchema,
  type SubmitClaimInput,
  submitClaimSchema,
} from "../domain/schemas";

/**
 * Expense claims (PRODUCT §4.18, WORKFLOWS §2a, 3b.3; ARCHITECTURE §4.2): zod →
 * `assertPermission()` → the transition function → revalidate → `Result`. The rules (the window,
 * the receipt amount, the category, who may decide) live in the functions.
 */

/** The member's own claim. Notifies the Owner, with no amount in the text (5.1). */
export const submitExpenseClaim = action(
  async (input: SubmitClaimInput): Promise<Result<{ claimId: string }>> => {
    const data = submitClaimSchema.parse(input);
    await assertPermission("attendance.self");
    const claimId = await repo.rpcSubmitClaim(data);
    revalidatePath("/leave/expenses");
    revalidatePath("/approvals");
    return ok({ claimId });
  },
);

/** The claimant takes back a claim still waiting. */
export const withdrawExpenseClaim = action(async (input: ClaimIdInput): Promise<Result<null>> => {
  const data = claimIdSchema.parse(input);
  await assertPermission("attendance.self");
  await repo.rpcWithdrawClaim(data.claimId);
  revalidatePath("/leave/expenses");
  revalidatePath("/approvals");
  return ok(null);
});

function revalidateDecisions(): void {
  // The layout carries the Approvals badge, so the whole signed-in tree refreshes.
  revalidatePath("/", "layout");
}

export const approveExpenseClaim = action(async (input: ClaimIdInput): Promise<Result<null>> => {
  const data = claimIdSchema.parse(input);
  await assertPermission("expenses.decide");
  await repo.rpcDecideClaim({ claimId: data.claimId, decision: "approve", reason: null });
  revalidateDecisions();
  return ok(null);
});

export const rejectExpenseClaim = action(async (input: RejectClaimInput): Promise<Result<null>> => {
  const data = rejectClaimSchema.parse(input);
  await assertPermission("expenses.decide");
  await repo.rpcDecideClaim({ claimId: data.claimId, decision: "reject", reason: data.reason });
  revalidateDecisions();
  return ok(null);
});

/** One claim or all of a person's approved claims of a month: one call each, per-claim results. */
export const markExpenseClaimsPaid = action(
  async (input: MarkPaidInput): Promise<Result<BulkOutcome>> => {
    const data = markPaidSchema.parse(input);
    await assertPermission("expenses.decide");
    const outcome = await eachId(data.claimIds, (claimId) =>
      repo.rpcMarkPaid(claimId, data.paidOn),
    );
    revalidateDecisions();
    return ok(outcome);
  },
);

/** Settings → Expenses: the amount above which a claim needs a receipt. */
export const updateExpenseReceiptAbove = action(
  async (input: ReceiptAboveInput): Promise<Result<null>> => {
    const data = receiptAboveSchema.parse(input);
    await assertPermission("settings.manage");
    await repo.updateReceiptAbove(data.receiptAbove);
    revalidatePath("/settings", "layout");
    return ok(null);
  },
);
