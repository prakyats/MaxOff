"use server";

import { z } from "zod";

import { revalidateScreens } from "@/core/lib/revalidate-screens";
import {
  type CreateDefinitionInput,
  createDefinitionSchema,
  type DefinitionArchiveInput,
  definitionArchiveSchema,
  type FieldDefinition,
  type UpdateDefinitionInput,
  updateDefinitionSchema,
} from "@/core/custom-fields";
import {
  createDefinition,
  setDefinitionArchived,
  updateDefinition,
} from "@/core/custom-fields/server";
import { action, AppError, isPostgresError, ok, type Result } from "@/core/errors";
import type { UnusedUsage } from "@/core/lib/owner-delete";
import { assertOwner, assertPermission } from "@/core/permissions/server";

import { deleteUnused, unusedUsage } from "../data/unused";

/**
 * Settings → Custom fields (3.2): zod → `assertPermission("lists.manage")` → the
 * `core/custom-fields` repository → revalidate → `Result`. Who may write which definition is
 * decided in the database (`app.field_definition_writable`, PERMISSIONS ¹ ²): the Owner for
 * global and project / item rows, the Owner or that client's Admin for a client-scoped row, and
 * `lists.manage` for a task row, for every task or one task type (4C). A
 * refused write comes back as NOT_FOUND from the repository or 42501 from RLS, mapped by
 * `action()`; the screen only hides what the caller may not do.
 */

/** unique (org, entity, key, scope): say which field, not "already exists". */
function keyTaken(error: unknown): never {
  if (isPostgresError(error) && error.code === "23505") {
    throw new AppError("CONFLICT", "A field with this key already exists here.", {
      fieldErrors: { key: ["A field with this key already exists here."] },
    });
  }
  throw error;
}

export const createFieldDefinition = action(
  async (input: CreateDefinitionInput): Promise<Result<FieldDefinition>> => {
    const data = createDefinitionSchema.parse(input);
    await assertPermission("lists.manage");
    try {
      const definition = await createDefinition({
        entity: data.entity,
        clientId: data.clientId,
        taskTypeId: data.taskTypeId,
        key: data.key,
        label: data.label,
        helpText: data.helpText,
        type: data.type,
        options: data.options,
        required: data.required,
        section: data.section,
      });
      revalidateScreens();
      return ok(definition);
    } catch (error) {
      keyTaken(error);
    }
  },
);

export const updateFieldDefinition = action(
  async (input: UpdateDefinitionInput): Promise<Result<null>> => {
    const data = updateDefinitionSchema.parse(input);
    await assertPermission("lists.manage");
    await updateDefinition(data.definitionId, {
      label: data.label,
      helpText: data.helpText,
      type: data.type,
      options: data.options,
      required: data.required,
      section: data.section,
    });
    revalidateScreens();
    return ok(null);
  },
);

export const setFieldDefinitionArchived = action(
  async (input: DefinitionArchiveInput): Promise<Result<null>> => {
    const data = definitionArchiveSchema.parse(input);
    await assertPermission("lists.manage");
    await setDefinitionArchived(data.definitionId, data.archived);
    revalidateScreens();
    return ok(null);
  },
);

const definitionIdSchema = z.object({ definitionId: z.uuid() });
export type DefinitionIdInput = z.input<typeof definitionIdSchema>;

/**
 * The Owner-only Delete of a field nothing has ever used (v1.8 V5a 6c): no value, no default and no
 * history under its key. The confirm reads the usage first; the database checks again.
 */
export const fieldDefinitionUsage = action(
  async (input: DefinitionIdInput): Promise<Result<UnusedUsage>> => {
    const { definitionId } = definitionIdSchema.parse(input);
    await assertOwner();
    return ok(await unusedUsage("field", definitionId));
  },
);

export const deleteFieldDefinition = action(
  async (input: DefinitionIdInput): Promise<Result<null>> => {
    const { definitionId } = definitionIdSchema.parse(input);
    await assertOwner();
    await deleteUnused("field", definitionId);
    revalidateScreens();
    return ok(null);
  },
);
