"use server";

import { revalidatePath } from "next/cache";

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
import { assertPermission } from "@/core/permissions/server";

/**
 * Settings → Custom fields (3.2): zod → `assertPermission("lists.manage")` → the
 * `core/custom-fields` repository → revalidate → `Result`. Who may write which definition is
 * decided in the database (`app.field_definition_writable`, PERMISSIONS ¹ ²): the Owner for
 * global and project / item rows, the Owner or that client's Admin for a client-scoped row, and
 * `lists.manage` for a task row, for every task or one task type (4C). A
 * refused write comes back as NOT_FOUND from the repository or 42501 from RLS, mapped by
 * `action()`; the screen only hides what the caller may not do.
 */

const PATH = "/settings/custom-fields";

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
      revalidatePath(PATH);
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
    revalidatePath(PATH);
    return ok(null);
  },
);

export const setFieldDefinitionArchived = action(
  async (input: DefinitionArchiveInput): Promise<Result<null>> => {
    const data = definitionArchiveSchema.parse(input);
    await assertPermission("lists.manage");
    await setDefinitionArchived(data.definitionId, data.archived);
    revalidatePath(PATH);
    return ok(null);
  },
);
