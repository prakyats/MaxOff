"use server";

import { action, ok, type Result } from "@/core/errors";
import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/billing";
import {
  type AdjustInput,
  adjustSchema,
  type ClearAdjustInput,
  clearAdjustSchema,
  type MarkAllBilledInput,
  markAllBilledSchema,
  type MarkBilledInput,
  markBilledSchema,
  type MarkNotBilledInput,
  markNotBilledSchema,
  type PlannedValueInput,
  plannedValueSchema,
  type RecordAdvanceInput,
  recordAdvanceSchema,
  type ReturnAdvanceInput,
  returnAdvanceSchema,
  type SetAmountInput,
  setAmountSchema,
  type SetCategoryInput,
  setCategorySchema,
  type SetCycleAmountInput,
  setCycleAmountSchema,
  type SetPriceInput,
  setPriceSchema,
} from "../domain/schemas";

/**
 * A project's billing (9.2; WORKFLOWS §6, ARCHITECTURE §4.1): zod → `assertPermission()` → the
 * `finance.edit` function → revalidate → `Result`. Owner only. The rules (whole rupees, which
 * cycles an amount covers, advances within the amount) live in the functions, which audit too.
 */

export const setProjectAmount = action(async (input: SetAmountInput): Promise<Result<null>> => {
  const data = setAmountSchema.parse(input);
  await assertPermission("finance.edit");
  await repo.rpcSetAmount(data.projectId, data.amount);
  revalidateScreens();
  return ok(null);
});

/** One cycle's amount alone: a month or week from before the project's first amount (Q1). */
export const setCycleAmount = action(async (input: SetCycleAmountInput): Promise<Result<null>> => {
  const data = setCycleAmountSchema.parse(input);
  await assertPermission("finance.edit");
  await repo.rpcSetCycleAmount(data.cycleId, data.amount);
  revalidateScreens();
  return ok(null);
});

export const setProjectCategory = action(async (input: SetCategoryInput): Promise<Result<null>> => {
  const data = setCategorySchema.parse(input);
  await assertPermission("finance.edit");
  await repo.rpcSetCategory(data.projectId, data.category);
  revalidateScreens();
  return ok(null);
});

export const setDeliverablePrice = action(async (input: SetPriceInput): Promise<Result<null>> => {
  const data = setPriceSchema.parse(input);
  await assertPermission("finance.edit");
  await repo.rpcSetPrice(data.itemId, data.price);
  revalidateScreens();
  return ok(null);
});

export const recordAdvance = action(
  async (input: RecordAdvanceInput): Promise<Result<{ advanceId: string }>> => {
    const data = recordAdvanceSchema.parse(input);
    await assertPermission("finance.edit");
    const advanceId = await repo.rpcRecordAdvance(data);
    revalidateScreens();
    return ok({ advanceId });
  },
);

export const returnAdvance = action(async (input: ReturnAdvanceInput): Promise<Result<null>> => {
  const data = returnAdvanceSchema.parse(input);
  await assertPermission("finance.edit");
  await repo.rpcReturnAdvance(data);
  revalidateScreens();
  return ok(null);
});

// --- v2.5 "Revenue every day": Billed, the adjustment, planned values, the history -------------------

/** Billed on a day (up to today, IST) with an optional note: a cycle, or a one-time project's. */
export const markBilled = action(async (input: MarkBilledInput): Promise<Result<null>> => {
  const data = markBilledSchema.parse(input);
  await assertPermission("finance.edit");
  await repo.rpcMarkBilled({
    cycleIds: [data.cycleId],
    billed: true,
    billedOn: data.billedOn,
    note: data.note,
  });
  revalidateScreens();
  return ok(null);
});

export const markNotBilled = action(async (input: MarkNotBilledInput): Promise<Result<null>> => {
  const data = markNotBilledSchema.parse(input);
  await assertPermission("finance.edit");
  await repo.rpcMarkBilled({ cycleIds: [data.cycleId], billed: false, billedOn: null, note: null });
  revalidateScreens();
  return ok(null);
});

/**
 * The Revenue page's "Mark all N billed": the month's lines not billed yet, in one go. Only lines
 * still not billed change (one billed elsewhere since the page was drawn keeps its day and note);
 * `marked` is how many did.
 */
export const markAllBilled = action(
  async (input: MarkAllBilledInput): Promise<Result<{ marked: number }>> => {
    const data = markAllBilledSchema.parse(input);
    await assertPermission("finance.edit");
    const marked = await repo.rpcMarkUnbilled({ cycleIds: data.cycleIds, billedOn: data.billedOn });
    revalidateScreens();
    return ok({ marked });
  },
);

export const adjustAchieved = action(async (input: AdjustInput): Promise<Result<null>> => {
  const data = adjustSchema.parse(input);
  await assertPermission("finance.edit");
  await repo.rpcAdjust(data);
  revalidateScreens();
  return ok(null);
});

export const backToCalculated = action(async (input: ClearAdjustInput): Promise<Result<null>> => {
  const data = clearAdjustSchema.parse(input);
  await assertPermission("finance.edit");
  await repo.rpcClearAdjust(data);
  revalidateScreens();
  return ok(null);
});

/** A planned deliverable's own value, or null: back to its share of the amount. */
export const setPlannedValue = action(async (input: PlannedValueInput): Promise<Result<null>> => {
  const data = plannedValueSchema.parse(input);
  await assertPermission("finance.edit");
  await repo.rpcSetPlannedValue(data.itemId, data.value);
  revalidateScreens();
  return ok(null);
});
