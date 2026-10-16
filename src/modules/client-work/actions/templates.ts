"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ok, type Result } from "@/core/errors";
import { GROUP_LABEL_MAX, STAGE_NAME_MAX, stageGroupsIssue } from "@/core/lib/stage-groups";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/templates";
import { addItemSchema } from "../domain/schemas";

/**
 * Save as template from a project or a deliverable, and "+ Add deliverable" from a deliverable
 * template (6b Release 2; ROADMAP 6b.13 (b), 6b.16; DATA-MODEL §5b): zod → `assertPermission()`
 * → the transition function → revalidate → `Result`. The functions decide the client's scope,
 * the name and the copy; these stay thin (ADR-0011).
 */

const TEMPLATE_NAME_MAX = 120;
const templateName = z
  .string()
  .trim()
  .min(1, "Name the template.")
  .max(TEMPLATE_NAME_MAX, `Keep the name under ${TEMPLATE_NAME_MAX} characters.`);
const saveProjectSchema = z.object({ projectId: z.uuid(), name: templateName });
const saveItemSchema = z.object({ itemId: z.uuid(), name: templateName });
const addGroupedItemSchema = addItemSchema.extend({
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

export type SaveProjectAsTemplateInput = z.input<typeof saveProjectSchema>;
export type SaveItemAsTemplateInput = z.input<typeof saveItemSchema>;
export type AddGroupedItemInput = z.input<typeof addGroupedItemSchema>;

/** A new template shows in Settings → Templates and New project; the record's history too. */
function revalidate(): void {
  revalidatePath("/", "layout");
}

export const saveProjectAsTemplate = action(
  async (input: SaveProjectAsTemplateInput): Promise<Result<{ id: string }>> => {
    const data = saveProjectSchema.parse(input);
    await assertPermission("projects.manage");
    await assertPermission("templates.manage");
    const id = await repo.saveProjectAsTemplate(data.projectId, data.name);
    revalidate();
    return ok({ id });
  },
);

export const saveItemAsTemplate = action(
  async (input: SaveItemAsTemplateInput): Promise<Result<{ id: string }>> => {
    const data = saveItemSchema.parse(input);
    await assertPermission("projects.manage");
    await assertPermission("templates.manage");
    const id = await repo.saveItemAsTemplate(data.itemId, data.name);
    revalidate();
    return ok({ id });
  },
);

/** "+ Add deliverable" with a deliverable template's groups, edited first (`item_add_grouped`). */
export const addGroupedItem = action(
  async (input: AddGroupedItemInput): Promise<Result<{ id: string }>> => {
    const data = addGroupedItemSchema.parse(input);
    await assertPermission("projects.manage");
    const id = await repo.addGroupedItem({
      cycleId: data.cycleId,
      title: data.title,
      plannedDate: data.plannedDate ?? null,
      notes: data.notes || null,
      stageGroups: data.stageGroups,
    });
    revalidate();
    return ok({ id });
  },
);
