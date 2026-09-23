"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, AppError, isPostgresError, ok, type Result } from "@/core/errors";
import { LIST_KEYS, LIST_LABELS, type ListKey, listItemInputSchema } from "@/core/lists";
import { archiveListItem, createListItem, moveListItem, updateListItem } from "@/core/lists/server";
import { assertPermission } from "@/core/permissions/server";

/**
 * The editable lists in Settings (ADR-0002). The engine is `core/lists`; this is the seam the
 * screens post to. One set of actions serves every list, so task types (4.1) and stage presets
 * (7.4) add a key to the registry and a page, not another action.
 */

const listKey = z.enum(LIST_KEYS);
const id = z.uuid();

const addSchema = z.object({ listKey, item: listItemInputSchema });
const renameSchema = z.object({ listKey, id, item: listItemInputSchema });
const archiveSchema = z.object({ listKey, id, archived: z.boolean() });
const moveSchema = z.object({ listKey, id, direction: z.enum(["up", "down"]) });

export type AddListItemInput = z.input<typeof addSchema>;
export type RenameListItemInput = z.input<typeof renameSchema>;
export type ArchiveListItemInput = z.input<typeof archiveSchema>;
export type MoveListItemInput = z.input<typeof moveSchema>;

/** The whole Settings subtree, plus the screens whose pickers read the list. */
function revalidateLists(): void {
  revalidatePath("/settings", "layout");
  revalidatePath("/people");
  revalidatePath("/me");
}

/** unique (org_id, list_key, lower(name)) where archived_at is null. */
function friendlyConflict(key: ListKey, error: unknown): never {
  if (isPostgresError(error) && error.code === "23505") {
    throw new AppError(
      "CONFLICT",
      `There is already a ${LIST_LABELS[key].singular.toLowerCase()} with that name.`,
    );
  }
  throw error;
}

export const addListItem = action(async (input: AddListItemInput): Promise<Result<null>> => {
  const data = addSchema.parse(input);
  await assertPermission("lists.manage");
  try {
    await createListItem(data.listKey, data.item);
  } catch (error) {
    friendlyConflict(data.listKey, error);
  }
  revalidateLists();
  return ok(null);
});

export const renameListItem = action(async (input: RenameListItemInput): Promise<Result<null>> => {
  const data = renameSchema.parse(input);
  await assertPermission("lists.manage");
  try {
    await updateListItem(data.id, data.item);
  } catch (error) {
    friendlyConflict(data.listKey, error);
  }
  revalidateLists();
  return ok(null);
});

/** Archived entries stay for history and leave the pickers (CLAUDE.md invariant 9). */
export const setListItemArchived = action(
  async (input: ArchiveListItemInput): Promise<Result<null>> => {
    const data = archiveSchema.parse(input);
    await assertPermission("lists.manage");
    try {
      await archiveListItem(data.id, data.archived);
    } catch (error) {
      // Restoring onto a name that was reused in the meantime hits the same unique index.
      friendlyConflict(data.listKey, error);
    }
    revalidateLists();
    return ok(null);
  },
);

export const moveListItemBy = action(async (input: MoveListItemInput): Promise<Result<null>> => {
  const data = moveSchema.parse(input);
  await assertPermission("lists.manage");
  await moveListItem(data.listKey, data.id, data.direction);
  revalidateLists();
  return ok(null);
});
