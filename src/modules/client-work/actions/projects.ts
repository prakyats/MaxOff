"use server";

import { revalidatePath } from "next/cache";

import { validateCustomFieldsFor } from "@/core/custom-fields/server";
import { action, ok, type Result } from "@/core/errors";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/projects";
import {
  type AddBlueprintInput,
  addBlueprintSchema,
  type AddStageInput,
  addStageSchema,
  type BlueprintIdInput,
  blueprintIdSchema,
  type CreateProjectInput,
  createProjectSchema,
  type ProjectIdInput,
  projectIdSchema,
  type ProjectReasonInput,
  projectReasonSchema,
  type StageIdInput,
  stageIdSchema,
  type UpdateBlueprintInput,
  updateBlueprintSchema,
  type UpdateProjectInput,
  updateProjectSchema,
  type UpdateStageInput,
  updateStageSchema,
} from "../domain/schemas";
import type { ProjectState } from "../domain/types";

/**
 * Project actions (7.3; ARCHITECTURE §4.1): zod → `assertPermission()` → the transition function →
 * revalidate → `Result`. The function decides the scope (another Admin's client is NOT_FOUND),
 * the state and the notifications (WORKFLOWS §9); these stay thin (ADR-0011). Client work shows on
 * the client pages, the project page, Today, Approvals, the calendar and the badges, so a change
 * revalidates the signed-in tree.
 */

function revalidate(): void {
  revalidatePath("/", "layout");
}

/** Only the keys the caller sent, as the function's column names. */
function changesOf(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

export const createProject = action(
  async (input: CreateProjectInput): Promise<Result<{ id: string }>> => {
    const data = createProjectSchema.parse(input);
    await assertPermission("projects.manage");
    const customFields = await validateCustomFieldsFor("project", data.customFields);
    const id = await repo.createProject({
      clientId: data.clientId,
      name: data.name,
      recurrence: data.recurrence,
      description: data.description || null,
      deliveryDate: data.recurrence === "one_time" ? (data.deliveryDate ?? null) : null,
      stages: data.stages,
      items: data.items,
      templateId: data.templateId ?? null,
      customFields,
    });
    revalidate();
    dispatchPushSoon();
    return ok({ id });
  },
);

export const updateProject = action(async (input: UpdateProjectInput): Promise<Result<null>> => {
  const data = updateProjectSchema.parse(input);
  await assertPermission("projects.manage");
  const customFields =
    data.customFields === undefined
      ? undefined
      : await validateCustomFieldsFor("project", data.customFields);
  await repo.updateProject(
    data.projectId,
    changesOf({
      name: data.name,
      description: data.description,
      delivery_date: data.deliveryDate,
      custom_fields: customFields,
    }),
  );
  revalidate();
  return ok(null);
});

export const completeProject = action(
  async (input: ProjectIdInput): Promise<Result<ProjectState>> => {
    const { projectId } = projectIdSchema.parse(input);
    await assertPermission("projects.complete");
    const state = await repo.completeProject(projectId);
    revalidate();
    dispatchPushSoon();
    return ok(state);
  },
);

export const cancelProject = action(
  async (input: ProjectReasonInput): Promise<Result<ProjectState>> => {
    const data = projectReasonSchema.parse(input);
    await assertPermission("projects.complete");
    const state = await repo.cancelProject(data.projectId, data.reason);
    revalidate();
    dispatchPushSoon();
    return ok(state);
  },
);

export const reopenProject = action(
  async (input: ProjectReasonInput): Promise<Result<ProjectState>> => {
    const data = projectReasonSchema.parse(input);
    await assertPermission("projects.complete");
    const state = await repo.reopenProject(data.projectId, data.reason);
    revalidate();
    dispatchPushSoon();
    return ok(state);
  },
);

/** "Start next cycle" (decision 3): the next period's cycle, at most 7 days early. */
export const startNextCycle = action(
  async (input: ProjectIdInput): Promise<Result<{ cycleId: string }>> => {
    const { projectId } = projectIdSchema.parse(input);
    await assertPermission("projects.manage");
    const cycleId = await repo.startNextCycle(projectId);
    revalidate();
    dispatchPushSoon();
    return ok({ cycleId });
  },
);

export const addStage = action(async (input: AddStageInput): Promise<Result<{ id: string }>> => {
  const data = addStageSchema.parse(input);
  await assertPermission("projects.manage");
  const id = await repo.addStage(data.projectId, data.name);
  revalidate();
  return ok({ id });
});

export const updateStage = action(async (input: UpdateStageInput): Promise<Result<null>> => {
  const data = updateStageSchema.parse(input);
  await assertPermission("projects.manage");
  await repo.updateStage(data.stageId, changesOf({ name: data.name, position: data.position }));
  revalidate();
  return ok(null);
});

export const archiveStage = action(async (input: StageIdInput): Promise<Result<null>> => {
  const { stageId } = stageIdSchema.parse(input);
  await assertPermission("projects.manage");
  await repo.archiveStage(stageId);
  revalidate();
  return ok(null);
});

export const addBlueprint = action(
  async (input: AddBlueprintInput): Promise<Result<{ id: string }>> => {
    const data = addBlueprintSchema.parse(input);
    await assertPermission("projects.manage");
    const id = await repo.addBlueprint(data.projectId, data.title);
    revalidate();
    return ok({ id });
  },
);

export const updateBlueprint = action(
  async (input: UpdateBlueprintInput): Promise<Result<null>> => {
    const data = updateBlueprintSchema.parse(input);
    await assertPermission("projects.manage");
    await repo.updateBlueprint(
      data.blueprintId,
      changesOf({ title: data.title, position: data.position }),
    );
    revalidate();
    return ok(null);
  },
);

export const archiveBlueprint = action(async (input: BlueprintIdInput): Promise<Result<null>> => {
  const { blueprintId } = blueprintIdSchema.parse(input);
  await assertPermission("projects.manage");
  await repo.archiveBlueprint(blueprintId);
  revalidate();
  return ok(null);
});
