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
  type AddItemStageInput,
  addItemStageSchema,
  type CarryDecideInput,
  carryDecideSchema,
  type ItemIdInput,
  itemIdSchema,
  type ItemIdsInput,
  itemIdsSchema,
  type ItemReasonInput,
  itemReasonSchema,
  type StageIdInput,
  stageIdSchema,
  type TickItemStageInput,
  tickItemStageSchema,
  type TickStagesInput,
  tickStagesSchema,
  type UpdateItemInput,
  updateItemSchema,
  type UpdateItemStageInput,
  updateItemStageSchema,
} from "../domain/schemas";

/**
 * Item actions (7.3 / 7.4; WORKFLOWS §5.3, §5.4 items 7, 9, 11, 16; amendment D): thin wrappers
 * around the transition functions. Mark done approves in the same step (D3); a done item is sent
 * back (the Owner) or reopened (the client's Admin) with a reason. Bulk "Mark N done" and "Tick
 * ‹stage› on N" call the function once per id (decision 16, one audit entry each); the carry
 * decisions are the function's own bulk call, answering one result per id (7A mechanics (3)). A
 * failed id keeps its message.
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

/** One "Mark done", which approves it (D3; the delayed send behind the 6-second Undo). */
export const markItemDone = action(async (input: ItemIdInput): Promise<Result<null>> => {
  const { itemId } = itemIdSchema.parse(input);
  await assertPermission("items.tick");
  await repo.markItemDone(itemId);
  revalidate();
  return ok(null);
});

/** "Mark N done": one call per id (decision 16), each approved at once (D3). */
export const markItemsDone = action(async (input: ItemIdsInput): Promise<Result<BulkOutcome>> => {
  const { itemIds } = itemIdsSchema.parse(input);
  await assertPermission("items.tick");
  const outcome = await eachId(itemIds, (id) => repo.markItemDone(id));
  revalidate();
  return ok(outcome);
});

/**
 * Send back (the Owner) or reopen (the client's Admin) a done item with a reason (amendment D3):
 * it is open again and no longer counts. `items.approve` means exactly this since D3.
 */
export const reopenItem = action(async (input: ItemReasonInput): Promise<Result<null>> => {
  const data = itemReasonSchema.parse(input);
  await assertPermission("items.approve");
  await repo.reopenItem(data.itemId, data.reason);
  revalidate();
  dispatchPushSoon();
  return ok(null);
});

/** A stage added to one item (amendment D2; at most 12, a name once). */
export const addItemStage = action(
  async (input: AddItemStageInput): Promise<Result<{ id: string }>> => {
    const data = addItemStageSchema.parse(input);
    await assertPermission("projects.manage");
    const id = await repo.addItemStage(data.itemId, data.name);
    revalidate();
    return ok({ id });
  },
);

/** One of an item's stages renamed or moved. */
export const updateItemStage = action(
  async (input: UpdateItemStageInput): Promise<Result<null>> => {
    const data = updateItemStageSchema.parse(input);
    await assertPermission("projects.manage");
    const changes: Record<string, unknown> = {};
    if (data.name !== undefined) changes.name = data.name;
    if (data.position !== undefined) changes.position = data.position;
    if (Object.keys(changes).length === 0) throw new AppError("VALIDATION", "Nothing to change.");
    await repo.updateItemStage(data.stageId, changes);
    revalidate();
    return ok(null);
  },
);

/** One of an item's stages removed: archived, its tick kept in the history. */
export const archiveItemStage = action(async (input: StageIdInput): Promise<Result<null>> => {
  const { stageId } = stageIdSchema.parse(input);
  await assertPermission("projects.manage");
  await repo.archiveItemStage(stageId);
  revalidate();
  return ok(null);
});

/** One of an item's stages ticked or unticked (decision 7: open items only). */
export const tickItemStage = action(async (input: TickItemStageInput): Promise<Result<null>> => {
  const data = tickItemStageSchema.parse(input);
  await assertPermission("items.tick");
  await repo.tickItemStage(data.stageId, data.done);
  revalidate();
  return ok(null);
});

/** "Tick ‹stage› on N": each chosen item's stage of that name, one call each (decision 16). */
export const tickStages = action(async (input: TickStagesInput): Promise<Result<BulkOutcome>> => {
  const { stageIds } = tickStagesSchema.parse(input);
  await assertPermission("items.tick");
  const outcome = await eachId(stageIds, (id) => repo.tickItemStage(id, true));
  revalidate();
  return ok(outcome);
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
