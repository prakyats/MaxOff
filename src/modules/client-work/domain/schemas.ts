import { z } from "zod";

import { repeatedName, repeatedStageMessage } from "@/core/lib/repeated-name";
import {
  DELIVERABLES_MAX,
  deliverablesIssue,
  GROUP_LABEL_MAX,
  stageGroupsIssue,
} from "@/core/lib/stage-groups";

/**
 * What the client-work actions accept (ARCHITECTURE §4.2: zod first). The transition functions
 * (7A, ADR-0006) check every rule again in the database; these keep a malformed request away and
 * give each field its own message. The limits are the functions' own (WORKFLOWS §5.4 "As built").
 */

export const PROJECT_NAME_MAX = 120;
export const PROJECT_DESCRIPTION_MAX = 2000;
export const STAGE_NAME_MAX = 120;
/** At most 100 stages on a deliverable, across its groups (6b; DATA-MODEL §5b). */
export const STAGES_MAX = 100;
export { DELIVERABLES_MAX, GROUP_LABEL_MAX };
export const ITEM_TITLE_MAX = 200;
export const ITEMS_MAX = 100;
export const ITEM_NOTES_MAX = 5000;
export const REASON_MAX = 1000;
/** At most 500 ids in one bulk call ("Mark N done", "Tick ‹stage› on N"); a page never shows more. */
const BULK_MAX = 500;

const id = z.uuid();
const isoDate = z.iso.date({ error: "Pick a date." });
const reason = z
  .string()
  .trim()
  .min(3, "Give a reason of at least 3 characters.")
  .max(REASON_MAX, `Keep the reason under ${REASON_MAX} characters.`);
const projectName = z
  .string()
  .trim()
  .min(1, "Give the project a name.")
  .max(PROJECT_NAME_MAX, `Keep the name under ${PROJECT_NAME_MAX} characters.`);
const description = z
  .string()
  .trim()
  .max(
    PROJECT_DESCRIPTION_MAX,
    `Keep the description under ${PROJECT_DESCRIPTION_MAX} characters.`,
  );
const stageName = z
  .string()
  .trim()
  .min(1, "Name the stage.")
  .max(STAGE_NAME_MAX, `Keep a stage name under ${STAGE_NAME_MAX} characters.`);
/** A list of stage names: at most 100, each once (ignoring case; `app.client_work_stage_names`). */
const stageNames = z
  .array(stageName)
  .max(STAGES_MAX, `At most ${STAGES_MAX} stages.`)
  .superRefine((names, context) => {
    const repeated = repeatedName(names);
    if (repeated !== null)
      context.addIssue({ code: "custom", message: repeatedStageMessage(repeated) });
  });
const itemTitle = z
  .string()
  .trim()
  .min(1, "Give the deliverable a title.")
  .max(ITEM_TITLE_MAX, `Keep a title under ${ITEM_TITLE_MAX} characters.`);
const notes = z
  .string()
  .trim()
  .max(ITEM_NOTES_MAX, `Keep the notes under ${ITEM_NOTES_MAX} characters.`);
const position = z.string().regex(/^[0-9a-z]{1,64}$/);
const ids = z.array(id).min(1, "Pick at least one deliverable.").max(BULK_MAX);
const customFields = z.record(z.string(), z.unknown());
/** A stage group's name (6b): 1..120 characters; null is the untitled group. */
const groupLabel = z
  .string()
  .trim()
  .min(1, "Name the group.")
  .max(GROUP_LABEL_MAX, `Keep a group name under ${GROUP_LABEL_MAX} characters.`);
/**
 * Stage groups (`StageGroupsJson`, DATA-MODEL §5b), trimmed, checked by the shared rules
 * (`stageGroupsIssue`, the database's `app.stage_groups_check`).
 */
const stageGroups = z
  .array(
    z.object({
      label: z.string().trim().nullable(),
      stages: z.array(z.string().trim()),
    }),
  )
  .superRefine((groups, context) => {
    const issue = stageGroupsIssue(groups);
    if (issue !== null) context.addIssue({ code: "custom", message: issue });
  });
/** Deliverables to create (`DeliverablesJson`): a title and its own groups (null = the defaults). */
const deliverables = z
  .array(z.object({ title: z.string().trim(), stageGroups: stageGroups.nullable() }))
  .superRefine((list, context) => {
    const issue = deliverablesIssue(list);
    if (issue !== null) context.addIssue({ code: "custom", message: issue });
  });

export const createProjectSchema = z
  .object({
    clientId: id,
    name: projectName,
    recurrence: z.enum(["one_time", "weekly", "monthly"], { error: "Pick how often it repeats." }),
    description: description.optional(),
    deliveryDate: isoDate.optional(),
    stages: stageNames,
    items: z.array(itemTitle).max(ITEMS_MAX, `At most ${ITEMS_MAX} deliverables.`),
    templateId: id.optional(),
    customFields: customFields.default({}),
  })
  .superRefine((value, context) => {
    // Amendment A: a one-time project has a delivery date; a weekly or monthly one has none.
    if (value.recurrence === "one_time" && !value.deliveryDate) {
      context.addIssue({
        code: "custom",
        path: ["deliveryDate"],
        message: "A one-time project needs a delivery date.",
      });
    }
  });
export type CreateProjectInput = z.input<typeof createProjectSchema>;

/**
 * New project with stage groups and deliverables (6b; `project_create_grouped`): the default
 * groups, and the deliverables each with its own groups (null = the defaults).
 */
export const createGroupedProjectSchema = z
  .object({
    clientId: id,
    name: projectName,
    recurrence: z.enum(["one_time", "weekly", "monthly"], { error: "Pick how often it repeats." }),
    description: description.optional(),
    deliveryDate: isoDate.optional(),
    stageGroups,
    deliverables,
    templateId: id.optional(),
    customFields: customFields.default({}),
  })
  .superRefine((value, context) => {
    if (value.recurrence === "one_time" && !value.deliveryDate) {
      context.addIssue({
        code: "custom",
        path: ["deliveryDate"],
        message: "A one-time project needs a delivery date.",
      });
    }
  });
export type CreateGroupedProjectInput = z.input<typeof createGroupedProjectSchema>;

export const updateProjectSchema = z.object({
  projectId: id,
  name: projectName.optional(),
  description: description.optional(),
  deliveryDate: isoDate.optional(),
  customFields: customFields.optional(),
});
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

export const projectIdSchema = z.object({ projectId: id });
export type ProjectIdInput = z.input<typeof projectIdSchema>;

export const projectReasonSchema = z.object({ projectId: id, reason });
export type ProjectReasonInput = z.input<typeof projectReasonSchema>;

/** A default stage added into a group (6b): `groupLabel` null or left out = the untitled group. */
export const addStageSchema = z.object({
  projectId: id,
  name: stageName,
  groupLabel: groupLabel.nullable().optional(),
});
export type AddStageInput = z.input<typeof addStageSchema>;

/** Renamed, moved, or moved into another group (`groupLabel`; null = the untitled group). */
export const updateStageSchema = z.object({
  stageId: id,
  name: stageName.optional(),
  position: position.optional(),
  groupLabel: groupLabel.nullable().optional(),
});
export type UpdateStageInput = z.input<typeof updateStageSchema>;

/** A new named group of default stages (6b): "Add from a preset" sends the preset's. */
export const addProjectStageGroupSchema = z.object({
  projectId: id,
  label: groupLabel,
  stages: stageNames.min(1, "A group needs at least one stage."),
});
export type AddProjectStageGroupInput = z.input<typeof addProjectStageGroupSchema>;

/**
 * A group renamed (`newLabel`; null makes it the untitled group) or moved (`position`, named
 * groups only). `label` null names the untitled group.
 */
export const updateProjectStageGroupSchema = z.object({
  projectId: id,
  label: groupLabel.nullable(),
  newLabel: groupLabel.nullable().optional(),
  position: position.optional(),
});
export type UpdateProjectStageGroupInput = z.input<typeof updateProjectStageGroupSchema>;

export const archiveProjectStageGroupSchema = z.object({
  projectId: id,
  label: groupLabel.nullable(),
});
export type ArchiveProjectStageGroupInput = z.input<typeof archiveProjectStageGroupSchema>;

export const stageIdSchema = z.object({ stageId: id });
export type StageIdInput = z.input<typeof stageIdSchema>;

export const addBlueprintSchema = z.object({ projectId: id, title: itemTitle });
export type AddBlueprintInput = z.input<typeof addBlueprintSchema>;

export const updateBlueprintSchema = z.object({
  blueprintId: id,
  title: itemTitle.optional(),
  position: position.optional(),
  /** The line's own stages (amendment D2): every item made from it starts with them. */
  stages: stageNames.optional(),
  /** The line's stages in groups (6b): sets them and the flattened `stages`. */
  stageGroups: stageGroups.optional(),
});
export type UpdateBlueprintInput = z.input<typeof updateBlueprintSchema>;

export const blueprintIdSchema = z.object({ blueprintId: id });
export type BlueprintIdInput = z.input<typeof blueprintIdSchema>;

export const addItemSchema = z.object({
  cycleId: id,
  title: itemTitle,
  plannedDate: isoDate.optional(),
  notes: notes.optional(),
});
export type AddItemInput = z.input<typeof addItemSchema>;

export const updateItemSchema = z.object({
  itemId: id,
  title: itemTitle.optional(),
  notes: notes.optional(),
  /** null clears the date. */
  plannedDate: isoDate.nullable().optional(),
  position: position.optional(),
  customFields: customFields.optional(),
});
export type UpdateItemInput = z.input<typeof updateItemSchema>;

export const itemIdSchema = z.object({ itemId: id });
export type ItemIdInput = z.input<typeof itemIdSchema>;

export const itemReasonSchema = z.object({ itemId: id, reason });
export type ItemReasonInput = z.input<typeof itemReasonSchema>;

export const itemIdsSchema = z.object({ itemIds: ids });
export type ItemIdsInput = z.input<typeof itemIdsSchema>;

// An item's own stages (amendment D2), in groups (6b).
export const addItemStageSchema = z.object({
  itemId: id,
  name: stageName,
  groupLabel: groupLabel.nullable().optional(),
});
export type AddItemStageInput = z.input<typeof addItemStageSchema>;

export const updateItemStageSchema = z.object({
  stageId: id,
  name: stageName.optional(),
  position: position.optional(),
  groupLabel: groupLabel.nullable().optional(),
});
export type UpdateItemStageInput = z.input<typeof updateItemStageSchema>;

export const addItemStageGroupSchema = z.object({
  itemId: id,
  label: groupLabel,
  stages: stageNames.min(1, "A group needs at least one stage."),
});
export type AddItemStageGroupInput = z.input<typeof addItemStageGroupSchema>;

export const updateItemStageGroupSchema = z.object({
  itemId: id,
  label: groupLabel.nullable(),
  newLabel: groupLabel.nullable().optional(),
  position: position.optional(),
});
export type UpdateItemStageGroupInput = z.input<typeof updateItemStageGroupSchema>;

export const archiveItemStageGroupSchema = z.object({
  itemId: id,
  label: groupLabel.nullable(),
});
export type ArchiveItemStageGroupInput = z.input<typeof archiveItemStageGroupSchema>;

export const tickItemStageSchema = z.object({ stageId: id, done: z.boolean() });
export type TickItemStageInput = z.input<typeof tickItemStageSchema>;

/** "Tick ‹stage› on N": each chosen item's stage of that name. */
export const tickStagesSchema = z.object({
  stageIds: z.array(id).min(1, "Pick at least one deliverable.").max(BULK_MAX),
});
export type TickStagesInput = z.input<typeof tickStagesSchema>;

/** A page of the activity panel (`GET /api/client-work/activity`). */
export const activityPageSchema = z
  .object({
    projectId: id,
    kind: z.enum(["all", "items", "stages", "project"]).default("all"),
    itemId: id.nullable().default(null),
    beforeAt: z.iso.datetime({ offset: true }).nullable().default(null),
    beforeId: z.coerce.number().int().positive().nullable().default(null),
  })
  .refine((value) => (value.beforeAt === null) === (value.beforeId === null), {
    message: "A page starts after an entry: give its time and its id.",
  });
export type ActivityPageInput = z.input<typeof activityPageSchema>;

export const carryDecideSchema = z
  .object({
    itemIds: ids,
    decision: z.enum(["carry_forward", "close", "leave_pending"]),
    reason: reason.optional(),
  })
  .superRefine((value, context) => {
    // Decision 16: close is one item at a time, with a reason.
    if (value.decision === "close" && (value.itemIds.length !== 1 || !value.reason)) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Close one deliverable at a time, with a reason.",
      });
    }
  });
export type CarryDecideInput = z.input<typeof carryDecideSchema>;

// ROADMAP 6b.16 (c)(d)(e) (migration client_work_bulk_and_rounds): the bulk edits take at most 100
// open deliverables (a cycle holds no more); each function checks every rule again.
const bulkIds = z
  .array(id)
  .min(1, "Select at least one deliverable.")
  .max(ITEMS_MAX, `Select at most ${ITEMS_MAX} deliverables at a time.`);

export const keepExtrasSchema = z.object({ cycleId: id, keep: z.boolean() });
export type KeepExtrasInput = z.input<typeof keepExtrasSchema>;

export const bulkPlanSchema = z.object({ itemIds: bulkIds, plannedDate: isoDate });
export type BulkPlanInput = z.input<typeof bulkPlanSchema>;

export const bulkShiftSchema = z.object({
  itemIds: bulkIds,
  days: z
    .number()
    .int()
    .min(-365, "Move the dates by 1 to 365 days, earlier or later.")
    .max(365, "Move the dates by 1 to 365 days, earlier or later.")
    .refine((days) => days !== 0, "Move the dates by 1 to 365 days, earlier or later."),
});
export type BulkShiftInput = z.input<typeof bulkShiftSchema>;

export const bulkGroupsSchema = z.object({
  itemIds: bulkIds,
  groups: stageGroups.refine(
    (groups) => groups.length > 0 && groups.every((group) => group.label !== null),
    "Add a group with a name and at least one stage.",
  ),
});
export type BulkGroupsInput = z.input<typeof bulkGroupsSchema>;

export const bulkRenameSchema = z.object({
  itemIds: bulkIds,
  pattern: z
    .string()
    .trim()
    .min(1, "Type the new name, with {n} where its number goes.")
    .max(ITEM_TITLE_MAX, `Keep the name under ${ITEM_TITLE_MAX} characters.`),
  start: z.number().int().min(0).max(9999).default(1),
});
export type BulkRenameInput = z.input<typeof bulkRenameSchema>;
