"use server";

import { revalidatePath } from "next/cache";

import { validateCustomFieldsFor } from "@/core/custom-fields/server";
import {
  action,
  AppError,
  type BulkOutcome,
  eachId,
  isErrorCode,
  ok,
  type Result,
} from "@/core/errors";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/projects";
import {
  type AddItemInput,
  addItemSchema,
  type CarryDecideInput,
  carryDecideSchema,
  type ItemIdInput,
  itemIdSchema,
  type ItemIdsInput,
  itemIdsSchema,
  type ItemReasonInput,
  itemReasonSchema,
  type TickStageInput,
  tickStageSchema,
  type TickStageOnInput,
  tickStageOnSchema,
  type UpdateItemInput,
  updateItemSchema,
} from "../domain/schemas";

/**
 * Item actions (7.3 / 7.4; WORKFLOWS §5.3, §5.4 items 6, 7, 9, 11, 16): thin wrappers around the
 * transition functions. Bulk "Mark N done" and "Tick ‹stage› on N" call the function once per id
 * (decision 16, one audit entry each); "Approve all N" and the carry decisions are the functions'
 * own bulk calls, answering one result per id (7A mechanics (3)). A failed id keeps its message.
 */

function revalidate(): void {
  revalidatePath("/", "layout");
}

/** A bulk function's per-id answer as the screens' `BulkOutcome`. */
function outcomeOf(rows: readonly repo.BulkRow[]): BulkOutcome {
  return {
    done: rows.filter((row) => row.ok).map((row) => row.id),
    failed: rows.flatMap((row) =>
      row.ok
        ? []
        : [
            {
              id: row.id,
              code: isErrorCode(row.code) ? row.code : "INTERNAL",
              message: row.message,
            },
          ],
    ),
  };
}

export const addItem = action(async (input: AddItemInput): Promise<Result<{ id: string }>> => {
  const data = addItemSchema.parse(input);
  await assertPermission("projects.manage");
  const id = await repo.addItem({
    cycleId: data.cycleId,
    title: data.title,
    plannedDate: data.plannedDate ?? null,
    notes: data.notes || null,
  });
  revalidate();
  return ok({ id });
});

export const updateItem = action(async (input: UpdateItemInput): Promise<Result<null>> => {
  const data = updateItemSchema.parse(input);
  await assertPermission("projects.manage");
  const changes: Record<string, unknown> = {};
  if (data.title !== undefined) changes.title = data.title;
  if (data.notes !== undefined) changes.notes = data.notes;
  if (data.plannedDate !== undefined) changes.planned_date = data.plannedDate ?? "";
  if (data.position !== undefined) changes.position = data.position;
  if (data.customFields !== undefined) {
    changes.custom_fields = await validateCustomFieldsFor("item", data.customFields);
  }
  if (Object.keys(changes).length === 0) throw new AppError("VALIDATION", "Nothing to change.");
  await repo.updateItem(data.itemId, changes);
  revalidate();
  return ok(null);
});

export const cancelItem = action(async (input: ItemReasonInput): Promise<Result<null>> => {
  const data = itemReasonSchema.parse(input);
  await assertPermission("projects.manage");
  await repo.cancelItem(data.itemId, data.reason);
  revalidate();
  dispatchPushSoon();
  return ok(null);
});

/** One "Mark done" (also the delayed send behind Today's Undo). */
export const markItemDone = action(async (input: ItemIdInput): Promise<Result<null>> => {
  const { itemId } = itemIdSchema.parse(input);
  await assertPermission("items.tick");
  await repo.markItemDone(itemId);
  revalidate();
  return ok(null);
});

/** "Mark N done": one call per id (decision 16). */
export const markItemsDone = action(async (input: ItemIdsInput): Promise<Result<BulkOutcome>> => {
  const { itemIds } = itemIdsSchema.parse(input);
  await assertPermission("items.tick");
  const outcome = await eachId(itemIds, (id) => repo.markItemDone(id));
  revalidate();
  return ok(outcome);
});

/** "Not done" (decision 6): done → open until approved. */
export const unmarkItemDone = action(async (input: ItemIdInput): Promise<Result<null>> => {
  const { itemId } = itemIdSchema.parse(input);
  await assertPermission("items.tick");
  await repo.unmarkItemDone(itemId);
  revalidate();
  return ok(null);
});

export const tickStage = action(async (input: TickStageInput): Promise<Result<null>> => {
  const data = tickStageSchema.parse(input);
  await assertPermission("items.tick");
  await repo.tickStage(data.itemId, data.stageId, data.done);
  revalidate();
  return ok(null);
});

/** "Tick ‹stage› on N": one call per id (decision 16). */
export const tickStageOn = action(async (input: TickStageOnInput): Promise<Result<BulkOutcome>> => {
  const data = tickStageOnSchema.parse(input);
  await assertPermission("items.tick");
  const outcome = await eachId(data.itemIds, (id) => repo.tickStage(id, data.stageId, true));
  revalidate();
  return ok(outcome);
});

/** One approval (the delayed send behind Undo, `/api/approvals/approve`). */
export const approveItem = action(async (input: ItemIdInput): Promise<Result<null>> => {
  const { itemId } = itemIdSchema.parse(input);
  await assertPermission("items.approve");
  const [row] = await repo.approveItems([itemId]);
  if (row && !row.ok) {
    throw new AppError(isErrorCode(row.code) ? row.code : "INTERNAL", row.message);
  }
  revalidate();
  return ok(null);
});

/** "Approve all N": the ids on screen in one call, one result per id. */
export const approveItems = action(async (input: ItemIdsInput): Promise<Result<BulkOutcome>> => {
  const { itemIds } = itemIdsSchema.parse(input);
  await assertPermission("items.approve");
  const outcome = outcomeOf(await repo.approveItems(itemIds));
  revalidate();
  return ok(outcome);
});

/** Send back one item with a reason (decision 16); it is open again. */
export const rejectItem = action(async (input: ItemReasonInput): Promise<Result<null>> => {
  const data = itemReasonSchema.parse(input);
  await assertPermission("items.approve");
  await repo.rejectItem(data.itemId, data.reason);
  revalidate();
  dispatchPushSoon();
  return ok(null);
});

/** Carry forward or leave pending in bulk, close one item with a reason (decision 16). */
export const carryDecide = action(async (input: CarryDecideInput): Promise<Result<BulkOutcome>> => {
  const data = carryDecideSchema.parse(input);
  await assertPermission("cycles.carry_decide");
  const outcome = outcomeOf(
    await repo.carryDecide(data.itemIds, data.decision, data.reason ?? null),
  );
  revalidate();
  dispatchPushSoon();
  return ok(outcome);
});
