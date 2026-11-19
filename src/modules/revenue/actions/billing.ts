"use server";

import { action, ok, type Result } from "@/core/errors";
import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/billing";
import {
  type RecordAdvanceInput,
  recordAdvanceSchema,
  type ReturnAdvanceInput,
  returnAdvanceSchema,
  type SetAmountInput,
  setAmountSchema,
  type SetCategoryInput,
  setCategorySchema,
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
