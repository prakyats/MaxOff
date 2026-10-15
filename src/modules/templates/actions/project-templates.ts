"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { validateCustomFieldsFor } from "@/core/custom-fields/server";
import { action, ok, type Result } from "@/core/errors";
import {
  DELIVERABLE_TITLE_MAX,
  deliverablesIssue,
  GROUP_LABEL_MAX,
  STAGE_NAME_MAX,
  stageGroupsIssue,
} from "@/core/lib/stage-groups";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/project-templates";
import {
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_ITEMS_MAX,
  TEMPLATE_NAME_MAX,
} from "../domain/project-templates";

/**
 * Settings → Templates → Project templates (7.4; kickoff 7 decision 23): `templates.manage`;
 * RLS lets an Admin write only their own (PERMISSIONS ⁴). A plain edit (ARCHITECTURE §4.2). The
 * field defaults are checked like a task template's: each value against its field, a required one
 * may stay empty (the create dialog asks for it). Since 6b (DATA-MODEL §5b) the stages come as
 * default **stage groups** and the items as **deliverables** with their own groups, checked in
 * the database's words (`stageGroupsIssue`, `deliverablesIssue`).
 */

/** Stage groups as the database checks them (`app.stage_groups_check`). */
const stageGroups = z
  .array(
    z.object({
      label: z.string().trim().max(GROUP_LABEL_MAX).nullable(),
      stages: z.array(z.string().trim().max(STAGE_NAME_MAX)),
    }),
  )
  .superRefine((groups, context) => {
    const issue = stageGroupsIssue(groups);
    if (issue !== null) context.addIssue({ code: "custom", message: issue });
  });

const values = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name the template.")
    .max(TEMPLATE_NAME_MAX, `Keep the name under ${TEMPLATE_NAME_MAX} characters.`),
  description: z
    .string()
    .trim()
    .max(
      TEMPLATE_DESCRIPTION_MAX,
      `Keep the description under ${TEMPLATE_DESCRIPTION_MAX} characters.`,
    )
    .optional(),
  recurrence: z.enum(["one_time", "weekly", "monthly"], { error: "Pick how often it repeats." }),
  // What a deliverable without its own groups uses.
  stageGroups,
  deliverables: z
    .array(
      z.object({
        title: z.string().trim().max(DELIVERABLE_TITLE_MAX),
        stageGroups: stageGroups.nullable(),
      }),
    )
    .max(TEMPLATE_ITEMS_MAX, `At most ${TEMPLATE_ITEMS_MAX} deliverables.`)
    .superRefine((deliverables, context) => {
      const issue = deliverablesIssue(deliverables);
      if (issue !== null) context.addIssue({ code: "custom", message: issue });
    }),
  fieldDefaults: z.record(z.string(), z.unknown()).default({}),
});
const updateSchema = values.extend({ templateId: z.uuid() });
const archiveSchema = z.object({ templateId: z.uuid(), archived: z.boolean() });

export type ProjectTemplateInput = z.input<typeof values>;
export type UpdateProjectTemplateInput = z.input<typeof updateSchema>;
export type ArchiveProjectTemplateInput = z.input<typeof archiveSchema>;

function revalidate(): void {
  revalidatePath("/settings", "layout");
  revalidatePath("/clients", "layout");
}

async function clean(data: z.output<typeof values>): Promise<repo.ProjectTemplateValues> {
  return {
    name: data.name,
    description: data.description || null,
    recurrence: data.recurrence,
    stageGroups: data.stageGroups,
    deliverables: data.deliverables,
    fieldDefaults: await validateCustomFieldsFor("project", data.fieldDefaults, {
      skipRequired: true,
    }),
  };
}

export const createProjectTemplate = action(
  async (input: ProjectTemplateInput): Promise<Result<null>> => {
    const data = values.parse(input);
    await assertPermission("templates.manage");
    await repo.createProjectTemplate(await clean(data));
    revalidate();
    return ok(null);
  },
);

export const updateProjectTemplate = action(
  async (input: UpdateProjectTemplateInput): Promise<Result<null>> => {
    const { templateId, ...data } = updateSchema.parse(input);
    await assertPermission("templates.manage");
    await repo.updateProjectTemplate(templateId, await clean(data));
    revalidate();
    return ok(null);
  },
);

export const setProjectTemplateArchived = action(
  async (input: ArchiveProjectTemplateInput): Promise<Result<null>> => {
    const data = archiveSchema.parse(input);
    await assertPermission("templates.manage");
    await repo.setProjectTemplateArchived(data.templateId, data.archived);
    revalidate();
    return ok(null);
  },
);
