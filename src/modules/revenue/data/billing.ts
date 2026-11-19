import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";

import { type BillingCategory, type ProjectBilling, toProjectBilling } from "../domain/billing";

/**
 * A project's billing (CLAUDE.md rule 3; DATA-MODEL §7). With the rest of `modules/revenue/data`,
 * the only place in `src/` that names the money functions. The read refuses anyone without
 * `finance.view` (the Owner alone holds it) and every write is a `finance.edit` function: an
 * Admin's request never reaches either (the page starts the read only once the role is known).
 */

/**
 * The project page's Billing section in one read: the category and amount, then a retainer's
 * cycle in view with its added deliverables, or a one-time project's dates and advances.
 * `cache()`d per request.
 */
export const readProjectBilling = cache(
  async (projectId: string, cycleId: string | null): Promise<ProjectBilling> => {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("project_billing_read", {
      project_id: projectId,
      ...(cycleId ? { cycle_id: cycleId } : {}),
    });
    if (error) throw error;
    return toProjectBilling(data);
  },
);

/** The project's amount (a retainer's per cycle, a one-time lump sum); the category is untouched. */
export async function rpcSetAmount(projectId: string, amount: number): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("billing_set_project", {
    project_id: projectId,
    amount,
    set_amount: true,
    // The function reads a null category as "leave it".
    category: null as unknown as BillingCategory,
  });
  if (error) throw error;
}

/** The project's billing category; the amount is untouched. */
export async function rpcSetCategory(projectId: string, category: BillingCategory): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("billing_set_project", {
    project_id: projectId,
    // Not read: `set_amount` is false.
    amount: null as unknown as number,
    set_amount: false,
    category,
  });
  if (error) throw error;
}

/** The price of a deliverable added on top of its cycle's amount. */
export async function rpcSetPrice(itemId: string, price: number): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("item_value_set", { item_id: itemId, value: price });
  if (error) throw error;
}

export async function rpcRecordAdvance(input: {
  projectId: string;
  amount: number;
  receivedOn: string;
  note: string | null;
}): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("advance_record", {
    project_id: input.projectId,
    amount: input.amount,
    received_on: input.receivedOn,
    // The function stores no note for null.
    note: input.note as string,
  });
  if (error) throw error;
  return data;
}

export async function rpcReturnAdvance(input: {
  advanceId: string;
  returnedOn: string;
  note: string | null;
}): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("advance_return", {
    advance_id: input.advanceId,
    returned_on: input.returnedOn,
    // The function stores no note for null.
    note: input.note as string,
  });
  if (error) throw error;
}
