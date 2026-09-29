"use server";

import { revalidatePath } from "next/cache";

import { validateCustomFieldsFor } from "@/core/custom-fields/server";
import { action, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/templates";
import {
  type ArchiveTemplateInput,
  archiveTemplateSchema,
  type SaveTemplateInput,
  saveTemplateSchema,
} from "../domain/schemas";

/**
 * Task templates (4.6; PRODUCT §4.6, WORKFLOWS §3.5, Kickoff 4 decision 19): `templates.manage`
 * (the Owner and Admins) adds one; RLS lets an Admin edit and archive their own, the Owner any
 * (`task_templates_update`), and `app.task_templates_guard()` keeps the author, an active type and
 * the stages right. The field defaults are checked against the type's task fields, without
 * "required" (a default may be left empty; the task form asks for it when the task is made).
 */

function refresh(): void {
  revalidatePath("/settings/templates");
  revalidatePath("/tasks", "layout");
}

export const saveTemplate = action(
  async (input: SaveTemplateInput): Promise<Result<{ id: string }>> => {
    const data = saveTemplateSchema.parse(input);
    await assertPermission("templates.manage");
    const fieldDefaults = await validateCustomFieldsFor("task", data.template.fieldDefaults, {
      taskTypeId: data.template.taskTypeId,
      skipRequired: true,
    });
    const values = { ...data.template, fieldDefaults };
    let id = data.templateId;
    if (id) await repo.updateTemplate(id, values);
    else id = await repo.createTemplate(values);
    refresh();
    return ok({ id });
  },
);

export const setTemplateArchived = action(
  async (input: ArchiveTemplateInput): Promise<Result<null>> => {
    const data = archiveTemplateSchema.parse(input);
    await assertPermission("templates.manage");
    await repo.setTemplateArchived(data.templateId, data.archived);
    refresh();
    return ok(null);
  },
);
