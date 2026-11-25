import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";

import { type BillingCategory, type ProjectBilling, toProjectBilling } from "../domain/billing";
import { type HistoryEntry, historyEntries, toHistoryRows } from "../domain/history";

/**
 * A project's billing (CLAUDE.md rule 3; DATA-MODEL §7). With the rest of `modules/revenue/data`,
 * the only place in `src/` that names the money functions (lint: `MONEY_NAMES` in
 * `eslint.config.mjs` lists every money table, view and function, and refuses each one in a
 * string outside `modules/revenue` and `core/db`). The read refuses anyone without
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
    // Cast, with its reason: `billing_set_project` takes a null category as "leave the category
    // as it is" (it changes the category only `if category is not null`), so null is a value the
    // function defines. Supabase generates every function argument without a default as non-null (Postgres
    // does not record an argument's nullability), so the type cannot say so.
    category: null as unknown as BillingCategory,
  });
  if (error) throw error;
}

/** The project's billing category; the amount is untouched. */
export async function rpcSetCategory(projectId: string, category: BillingCategory): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("billing_set_project", {
    project_id: projectId,
    // Cast, with its reason: `billing_set_project` reads `amount` only when `set_amount` is true;
    // with false it is never looked at, and null is the one value that cannot be mistaken for an
    // amount. The generated argument type is non-null only because Supabase types every argument
    // without a default that way.
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
    // Cast, with its reason: `advance_record` stores a null note as "no note" (the column is
    // nullable and the function trims and nulls an empty one). The generated argument type is
    // `string` only because Supabase types every argument without a default as non-null.
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
    // Cast, with its reason: `advance_return` stores a null note as "no note" on the return
    // (`return_note` is nullable). The generated argument type is `string` only because Supabase
    // types every argument without a default as non-null.
    note: input.note as string,
  });
  if (error) throw error;
}

/**
 * One retainer cycle's own amount (Q1's "until the Owner fills each one"): only that cycle; the
 * project's amount and every other cycle are untouched.
 */
export async function rpcSetCycleAmount(cycleId: string, amount: number): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("billing_set_cycle_amount", { cycle_id: cycleId, amount });
  if (error) throw error;
}

// --- v2.5 "Revenue every day" ---------------------------------------------------------------------

/**
 * Billed (on a day, with a note) or back to Not billed, for one cycle: a one-time project through its
 * one cycle. One call, one transaction.
 */
export async function rpcMarkBilled(input: {
  cycleId: string;
  billed: boolean;
  billedOn: string | null;
  note: string | null;
}): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("billing_mark", {
    cycle_ids: [input.cycleId],
    billed: input.billed,
    // Cast, with its reason: `billing_mark` takes a null day as today (IST) and ignores the day
    // and the note when marking Not billed; both are nullable in the function. The generated
    // argument types are non-null only because Supabase types every argument without a
    // default that way.
    billed_on: input.billedOn as string,
    note: input.note as string,
  });
  if (error) throw error;
  return data;
}

/**
 * "Mark all N billed" (the Revenue page): Billed on a day for the cycles given that are **not billed
 * yet**. `billing_mark_unbilled` leaves a line billed since the page was drawn exactly as it is (its
 * day and its note) and answers how many it changed. The whole list is **one call, one transaction**
 * (the function takes up to 2,000): every line is marked, or, on any refusal, none is.
 */
export async function rpcMarkUnbilled(input: {
  cycleIds: readonly string[];
  billedOn: string | null;
}): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("billing_mark_unbilled", {
    cycle_ids: [...input.cycleIds],
    // Cast, with its reason: `billing_mark_unbilled` takes a null day as today (IST); the
    // argument is nullable in the function. The generated type is non-null only because
    // Supabase types every argument without a default that way.
    billed_on: input.billedOn as string,
  });
  if (error) throw error;
  return data;
}

/** The Owner's adjusted Achieved of a retainer cycle or a completed one-time project. */
export async function rpcAdjust(input: {
  scope: "cycle" | "project";
  refId: string;
  value: number;
  note: string;
}): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("revenue_override_set", {
    scope: input.scope,
    ref_id: input.refId,
    adjusted_value: input.value,
    note: input.note,
  });
  if (error) throw error;
}

/** "Back to calculated": the adjustment is kept, superseded, with the note. */
export async function rpcClearAdjust(input: {
  scope: "cycle" | "project";
  refId: string;
  note: string;
}): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("revenue_override_clear", {
    scope: input.scope,
    ref_id: input.refId,
    note: input.note,
  });
  if (error) throw error;
}

/** A planned deliverable's own value off the top of its cycle's amount; null = back to its share. */
export async function rpcSetPlannedValue(itemId: string, value: number | null): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("item_value_set", {
    item_id: itemId,
    // Cast, with its reason: `item_value_set` takes null as "no value of its own" (back to the
    // even share for a planned deliverable); the column and the argument are nullable. The
    // generated type is non-null only because Supabase types every argument without a default
    // that way.
    value: value as number,
  });
  if (error) throw error;
}

/**
 * A page of the project's Billing history (Q7): the newest `limit` audit rows of its money tables,
 * worded. `rows` is how many the read answered (some are left out of the lines), so the screen
 * knows whether older ones may exist.
 */
export async function readBillingHistory(input: {
  projectId: string;
  limit: number;
  oneTime: boolean;
}): Promise<{ rows: number; entries: HistoryEntry[] }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("project_billing_history", {
    project_id: input.projectId,
    limit_count: input.limit,
  });
  if (error) throw error;
  const rows = toHistoryRows(data);
  return { rows: rows.length, entries: historyEntries(rows, { oneTime: input.oneTime }) };
}
