"use server";

import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { validateCustomFieldsFor } from "@/core/custom-fields/server";
import { action, ok, type Result } from "@/core/errors";
import type { TemplateUsage } from "@/core/lib/owner-delete";
import { assertOwner, assertPermission } from "@/core/permissions/server";

import * as repo from "../data/templates";
import {
  type ArchiveTemplateInput,
  archiveTemplateSchema,
  type TemplateIdInput,
  templateIdSchema,
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
  revalidateScreens();
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

/** The Owner-only Delete (v1.8 V5a 6b): what the confirm says first. */
export const taskTemplateUsage = action(
  async (input: TemplateIdInput): Promise<Result<TemplateUsage>> => {
    const { templateId } = templateIdSchema.parse(input);
    await assertOwner();
    return ok(await repo.taskTemplateUsage(templateId));
  },
);

/** The Owner deletes a task template; the open tasks that follow it keep their reminders. */
export const deleteTaskTemplate = action(async (input: TemplateIdInput): Promise<Result<null>> => {
  const { templateId } = templateIdSchema.parse(input);
  await assertOwner();
  await repo.deleteTaskTemplate(templateId);
  refresh();
  return ok(null);
});
