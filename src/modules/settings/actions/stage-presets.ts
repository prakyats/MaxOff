"use server";

import { z } from "zod";

import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { action, ok, type Result } from "@/core/errors";
import { repeatedName, repeatedStageMessage } from "@/core/lib/repeated-name";
import { assertOwner, assertPermission } from "@/core/permissions/server";

import * as repo from "../data/stage-presets";
import {
  cleanStages,
  PRESET_NAME_MAX,
  PRESET_STAGE_MAX,
  PRESET_STAGES_MAX,
} from "../domain/stage-presets";

/**
 * Settings → Stage presets (7.4; kickoff 7 decision 22): `lists.manage` (the Owner and Admins);
 * RLS lets an Admin write only their own (PERMISSIONS ⁴). A plain edit: zod → permission → write →
 * revalidate (ARCHITECTURE §4.2), audited by the trigger.
 */

const values = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name the preset.")
    .max(PRESET_NAME_MAX, `Keep the name under ${PRESET_NAME_MAX} characters.`),
  stages: z
    .array(z.string().max(PRESET_STAGE_MAX, `Keep a stage under ${PRESET_STAGE_MAX} characters.`))
    .transform(cleanStages)
    .pipe(
      z
        .array(z.string())
        .min(1, "Add at least one stage.")
        .max(PRESET_STAGES_MAX, `At most ${PRESET_STAGES_MAX} stages.`)
        .superRefine((names, context) => {
          // A project's stages from it are each once (the 7B rework's review).
          const repeated = repeatedName(names);
          if (repeated !== null) {
            context.addIssue({ code: "custom", message: repeatedStageMessage(repeated) });
          }
        }),
    ),
});
const createSchema = values;
const updateSchema = values.extend({ presetId: z.uuid() });
const archiveSchema = z.object({ presetId: z.uuid(), archived: z.boolean() });
const deleteSchema = z.object({ presetId: z.uuid() });

export type StagePresetInput = z.input<typeof createSchema>;
export type UpdateStagePresetInput = z.input<typeof updateSchema>;
export type ArchiveStagePresetInput = z.input<typeof archiveSchema>;

function revalidate(): void {
  revalidateScreens();
}

export const createStagePreset = action(async (input: StagePresetInput): Promise<Result<null>> => {
  const data = createSchema.parse(input);
  await assertPermission("lists.manage");
  await repo.createStagePreset(data);
  revalidate();
  return ok(null);
});

export const updateStagePreset = action(
  async (input: UpdateStagePresetInput): Promise<Result<null>> => {
    const { presetId, ...data } = updateSchema.parse(input);
    await assertPermission("lists.manage");
    await repo.updateStagePreset(presetId, data);
    revalidate();
    return ok(null);
  },
);

export const setStagePresetArchived = action(
  async (input: ArchiveStagePresetInput): Promise<Result<null>> => {
    const data = archiveSchema.parse(input);
    await assertPermission("lists.manage");
    await repo.setStagePresetArchived(data.presetId, data.archived);
    revalidate();
    return ok(null);
  },
);

export type DeleteStagePresetInput = z.input<typeof deleteSchema>;

/** The Owner-only Delete (v1.8 V5a 6b): any preset, any time; stages copied from it stay. */
export const deleteStagePreset = action(
  async (input: DeleteStagePresetInput): Promise<Result<null>> => {
    const { presetId } = deleteSchema.parse(input);
    await assertOwner();
    await repo.deleteStagePreset(presetId);
    revalidateScreens();
    return ok(null);
  },
);
