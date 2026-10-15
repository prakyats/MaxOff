"use server";

import { revalidatePath } from "next/cache";

import { action, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/bulk";
import {
  type BulkGroupsInput,
  bulkGroupsSchema,
  type BulkPlanInput,
  bulkPlanSchema,
  type BulkRenameInput,
  bulkRenameSchema,
  type BulkShiftInput,
  bulkShiftSchema,
  type ItemIdInput,
  itemIdSchema,
  type KeepExtrasInput,
  keepExtrasSchema,
} from "../domain/schemas";

/**
 * ROADMAP 6b.16 (c)(d)(e): "+ Another revision round", "Keep this month's extra deliverables next
 * month?" and the bulk edits on selected deliverables. Thin wrappers (zod → permission → one
 * transition function → revalidate): each bulk edit is ONE call, so the whole selection changes or
 * none does, and the function names the deliverable that stopped it.
 */

function revalidate(): void {
  revalidatePath("/", "layout");
}

export const addRevisionRound = action(
  async (input: ItemIdInput): Promise<Result<{ name: string }>> => {
    const { itemId } = itemIdSchema.parse(input);
    await assertPermission("projects.manage");
    const name = await repo.addRevisionRound(itemId);
    revalidate();
    return ok({ name });
  },
);

export const keepExtras = action(
  async (input: KeepExtrasInput): Promise<Result<{ added: number }>> => {
    const data = keepExtrasSchema.parse(input);
    await assertPermission("projects.manage");
    const added = await repo.keepExtras(data.cycleId, data.keep);
    revalidate();
    return ok({ added });
  },
);

export const planItems = action(
  async (input: BulkPlanInput): Promise<Result<{ count: number }>> => {
    const data = bulkPlanSchema.parse(input);
    await assertPermission("projects.manage");
    const count = await repo.setPlannedDates(data.itemIds, data.plannedDate);
    revalidate();
    return ok({ count });
  },
);

export const shiftItems = action(
  async (input: BulkShiftInput): Promise<Result<{ count: number }>> => {
    const data = bulkShiftSchema.parse(input);
    await assertPermission("projects.manage");
    const count = await repo.shiftPlannedDates(data.itemIds, data.days);
    revalidate();
    return ok({ count });
  },
);

export const addGroupsToItems = action(
  async (input: BulkGroupsInput): Promise<Result<{ count: number }>> => {
    const data = bulkGroupsSchema.parse(input);
    await assertPermission("projects.manage");
    const count = await repo.addStageGroupsTo(data.itemIds, data.groups);
    revalidate();
    return ok({ count });
  },
);

export const renameItems = action(
  async (input: BulkRenameInput): Promise<Result<{ count: number }>> => {
    const data = bulkRenameSchema.parse(input);
    await assertPermission("projects.manage");
    const rows = await repo.renameItems(data.itemIds, data.pattern, data.start);
    revalidate();
    return ok({ count: rows.filter((row) => row.from !== row.to).length });
  },
);
