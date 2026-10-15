"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ok, type Result } from "@/core/errors";
import { GROUP_LABEL_MAX, STAGE_NAME_MAX, stageGroupsIssue } from "@/core/lib/stage-groups";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/deliverable-templates";
import { ARCHIVE_REASON_MAX, DELIVERABLE_TEMPLATE_NAME_MAX } from "../domain/deliverable-templates";

/**
 * Settings → Templates → Deliverable templates (6b Release 2): `templates.manage`; RLS lets an
 * Admin write only their own (PERMISSIONS ⁴). A plain edit (ARCHITECTURE §4.2): the groups are
 * checked in the database's words (`stageGroupsIssue`), an archive needs a reason.
 */

const values = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name the template.")
    .max(
      DELIVERABLE_TEMPLATE_NAME_MAX,
      `Keep the name under ${DELIVERABLE_TEMPLATE_NAME_MAX} characters.`,
    ),
  stageGroups: z
    .array(
      z.object({
        label: z.string().trim().max(GROUP_LABEL_MAX).nullable(),
        stages: z.array(z.string().trim().max(STAGE_NAME_MAX)),
      }),
    )
    .superRefine((groups, context) => {
      const issue = stageGroupsIssue(groups);
      if (issue !== null) context.addIssue({ code: "custom", message: issue });
    }),
});
const updateSchema = values.extend({ templateId: z.uuid() });
const archiveSchema = z.object({
  templateId: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(1, "Say why it is archived.")
    .max(ARCHIVE_REASON_MAX, `Keep the reason under ${ARCHIVE_REASON_MAX} characters.`),
});
const restoreSchema = z.object({ templateId: z.uuid() });

export type DeliverableTemplateInput = z.input<typeof values>;
export type UpdateDeliverableTemplateInput = z.input<typeof updateSchema>;
export type ArchiveDeliverableTemplateInput = z.input<typeof archiveSchema>;
export type RestoreDeliverableTemplateInput = z.input<typeof restoreSchema>;

function revalidate(): void {
  revalidatePath("/settings", "layout");
  revalidatePath("/clients", "layout");
}

export const createDeliverableTemplate = action(
  async (input: DeliverableTemplateInput): Promise<Result<null>> => {
    const data = values.parse(input);
    await assertPermission("templates.manage");
    await repo.createDeliverableTemplate(data);
    revalidate();
    return ok(null);
  },
);

export const updateDeliverableTemplate = action(
  async (input: UpdateDeliverableTemplateInput): Promise<Result<null>> => {
    const { templateId, ...data } = updateSchema.parse(input);
    await assertPermission("templates.manage");
    await repo.updateDeliverableTemplate(templateId, data);
    revalidate();
    return ok(null);
  },
);

export const archiveDeliverableTemplate = action(
  async (input: ArchiveDeliverableTemplateInput): Promise<Result<null>> => {
    const data = archiveSchema.parse(input);
    await assertPermission("templates.manage");
    await repo.setDeliverableTemplateArchived(data.templateId, data.reason);
    revalidate();
    return ok(null);
  },
);

export const restoreDeliverableTemplate = action(
  async (input: RestoreDeliverableTemplateInput): Promise<Result<null>> => {
    const data = restoreSchema.parse(input);
    await assertPermission("templates.manage");
    await repo.setDeliverableTemplateArchived(data.templateId, null);
    revalidate();
    return ok(null);
  },
);
