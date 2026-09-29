import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";

import {
  type ClaimSetup,
  type ClaimState,
  type ExpenseClaim,
  isClaimState,
} from "../domain/claims";

/**
 * Expense claims (CLAUDE.md rule 3; DATA-MODEL §7a `expense_claims`). The one place in `src/`
 * that names the table (lint, ADR-0007 amendment). Reads go through RLS: the claimant's own rows,
 * everyone's for `expenses.decide` (the Owner); an Admin reads nobody else's. Every write is a
 * transition function.
 */

const CLAIM_COLUMNS =
  "id, member_id, expense_date, amount, note, receipt_file_id, state, decision_reason, paid_on, created_at, category:list_items!category_id(name)";

type ClaimRow = {
  id: string;
  member_id: string;
  expense_date: string;
  amount: number | string;
  note: string;
  receipt_file_id: string | null;
  state: string;
  decision_reason: string | null;
  paid_on: string | null;
  created_at: string;
  category: { name: string } | { name: string }[] | null;
};

function toState(value: string): ClaimState {
  if (isClaimState(value)) return value;
  throw new Error(`Unknown claim state: ${value}`);
}

function toClaim(row: ClaimRow): ExpenseClaim {
  const category = Array.isArray(row.category) ? (row.category[0] ?? null) : row.category;
  return {
    id: row.id,
    memberId: row.member_id,
    expenseDate: row.expense_date,
    amount: Number(row.amount),
    categoryName: category?.name ?? "Other",
    note: row.note,
    receiptFileId: row.receipt_file_id,
    state: toState(row.state),
    decisionReason: row.decision_reason,
    paidOn: row.paid_on,
    createdAt: row.created_at,
  };
}

/** One member's claims, newest expense first (their Expenses tab; 100 is months of claims). */
export async function listOwnClaims(memberId: string): Promise<ExpenseClaim[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("expense_claims")
    .select(CLAIM_COLUMNS)
    .eq("member_id", memberId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as unknown as ClaimRow[]).map(toClaim);
}

/** At most this many waiting claims are listed; nobody decides more in one sitting. */
const PENDING_LIMIT = 200;

/** Every claim waiting for the Owner, oldest first, with the person's name. */
export async function listPendingClaims(): Promise<(ExpenseClaim & { memberName: string })[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("expense_claims")
    .select(`${CLAIM_COLUMNS}, member:members!member_id(full_name)`)
    .eq("state", "submitted")
    .order("created_at", { ascending: true })
    .limit(PENDING_LIMIT);
  if (error) throw error;
  return (data as unknown as (ClaimRow & { member: { full_name: string } | null })[]).map(
    (row) => ({ ...toClaim(row), memberName: row.member?.full_name ?? "Someone" }),
  );
}

/** How many claims wait for the Owner: part of the Approvals badge. */
export async function countPendingClaims(): Promise<number> {
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from("expense_claims")
    .select("id", { count: "exact", head: true })
    .eq("state", "submitted");
  if (error) throw error;
  return count ?? 0;
}

/** One member's claims dated in a month (the Owner's view of their month), oldest first. */
export async function listMemberMonthClaims(
  memberId: string,
  range: { first: string; last: string },
): Promise<ExpenseClaim[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("expense_claims")
    .select(CLAIM_COLUMNS)
    .eq("member_id", memberId)
    .gte("expense_date", range.first)
    .lte("expense_date", range.last)
    .order("expense_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as ClaimRow[]).map(toClaim);
}

/**
 * The approved, unpaid claims dated in a month, per member (the team month report's expense
 * column). Read under RLS: only `expenses.decide` sees anyone else's.
 */
export async function listApprovedInMonth(range: {
  first: string;
  last: string;
}): Promise<{ memberId: string; amount: number }[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("expense_claims")
    .select("member_id, amount")
    .eq("state", "approved")
    .gte("expense_date", range.first)
    .lte("expense_date", range.last);
  if (error) throw error;
  return data.map((row) => ({ memberId: row.member_id, amount: Number(row.amount) }));
}

/**
 * The claim form's setup: the active categories in the Owner's order, and the receipt amount.
 * Once per request (`cache()`): My Day and Today start it with the session read (`startEarly`).
 */
export const getClaimSetup = cache(async (): Promise<ClaimSetup> => {
  const supabase = await createServerSupabase();
  const [categories, settings] = await Promise.all([
    supabase
      .from("list_items")
      .select("id, name")
      .eq("list_key", "expense_category")
      .is("archived_at", null)
      .order("position", { ascending: true }),
    supabase.from("org_settings").select("expense_receipt_above").limit(1).maybeSingle(),
  ]);
  if (categories.error) throw categories.error;
  if (settings.error) throw settings.error;
  return {
    categories: categories.data,
    receiptAbove: Number(settings.data?.expense_receipt_above ?? 500),
  };
});

/** The receipt amount alone (Settings → Expenses). */
export async function getReceiptAbove(): Promise<number> {
  return (await getClaimSetup()).receiptAbove;
}

export async function updateReceiptAbove(amount: number): Promise<void> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("org_settings")
    .update({ expense_receipt_above: amount })
    .not("org_id", "is", null)
    .select("org_id");
  if (error) throw error;
  // RLS answers an update it refuses with no rows, not an error.
  if (data.length === 0) throw new Error("The receipt amount was not saved.");
}

export async function rpcSubmitClaim(input: {
  expenseDate: string;
  amount: number;
  categoryId: string;
  note: string;
  receiptFileId: string | null;
}): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("expense_claim_submit", {
    expense_date: input.expenseDate,
    amount: input.amount,
    category_id: input.categoryId,
    note: input.note,
    ...(input.receiptFileId ? { receipt_file_id: input.receiptFileId } : {}),
  });
  if (error) throw error;
  return data;
}

export async function rpcWithdrawClaim(claimId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("expense_claim_withdraw", { claim_id: claimId });
  if (error) throw error;
}

export async function rpcDecideClaim(input: {
  claimId: string;
  decision: "approve" | "reject";
  reason: string | null;
}): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("expense_claim_decide", {
    claim_id: input.claimId,
    decision: input.decision,
    ...(input.reason ? { reason: input.reason } : {}),
  });
  if (error) throw error;
}

export async function rpcMarkPaid(claimId: string, paidOn: string | null): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("expense_claim_mark_paid", {
    claim_id: claimId,
    ...(paidOn ? { paid_on: paidOn } : {}),
  });
  if (error) throw error;
}
