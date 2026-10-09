import { z } from "zod";

/**
 * What the client-work actions accept (ARCHITECTURE §4.2: zod first). The transition functions
 * (7A, ADR-0006) check every rule again in the database; these keep a malformed request away and
 * give each field its own message. The limits are the functions' own (WORKFLOWS §5.4 "As built").
 */

export const PROJECT_NAME_MAX = 120;
export const PROJECT_DESCRIPTION_MAX = 2000;
export const STAGE_NAME_MAX = 120;
export const STAGES_MAX = 12;
export const ITEM_TITLE_MAX = 200;
export const ITEMS_MAX = 100;
export const ITEM_NOTES_MAX = 5000;
export const REASON_MAX = 1000;
/** `item_approve` takes at most 500 ids; a page never shows more than that. */
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
const itemTitle = z
  .string()
  .trim()
  .min(1, "Give the item a title.")
  .max(ITEM_TITLE_MAX, `Keep a title under ${ITEM_TITLE_MAX} characters.`);
const notes = z
  .string()
  .trim()
  .max(ITEM_NOTES_MAX, `Keep the notes under ${ITEM_NOTES_MAX} characters.`);
const position = z.string().regex(/^[0-9a-z]{1,64}$/);
const ids = z.array(id).min(1, "Pick at least one item.").max(BULK_MAX);
const customFields = z.record(z.string(), z.unknown());

export const createProjectSchema = z
  .object({
    clientId: id,
    name: projectName,
    recurrence: z.enum(["one_time", "weekly", "monthly"], { error: "Pick how often it repeats." }),
    description: description.optional(),
    deliveryDate: isoDate.optional(),
    stages: z.array(stageName).max(STAGES_MAX, `At most ${STAGES_MAX} stages.`),
    items: z.array(itemTitle).max(ITEMS_MAX, `At most ${ITEMS_MAX} items.`),
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

export const addStageSchema = z.object({ projectId: id, name: stageName });
export type AddStageInput = z.input<typeof addStageSchema>;

export const updateStageSchema = z.object({
  stageId: id,
  name: stageName.optional(),
  position: position.optional(),
});
export type UpdateStageInput = z.input<typeof updateStageSchema>;

export const stageIdSchema = z.object({ stageId: id });
export type StageIdInput = z.input<typeof stageIdSchema>;

export const addBlueprintSchema = z.object({ projectId: id, title: itemTitle });
export type AddBlueprintInput = z.input<typeof addBlueprintSchema>;

export const updateBlueprintSchema = z.object({
  blueprintId: id,
  title: itemTitle.optional(),
  position: position.optional(),
  /** The line's own stages (amendment D2): every item made from it starts with them. */
  stages: z.array(stageName).max(STAGES_MAX, `At most ${STAGES_MAX} stages.`).optional(),
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

// An item's own stages (amendment D2).
export const addItemStageSchema = z.object({ itemId: id, name: stageName });
export type AddItemStageInput = z.input<typeof addItemStageSchema>;

export const updateItemStageSchema = z.object({
  stageId: id,
  name: stageName.optional(),
  position: position.optional(),
});
export type UpdateItemStageInput = z.input<typeof updateItemStageSchema>;

export const tickItemStageSchema = z.object({ stageId: id, done: z.boolean() });
export type TickItemStageInput = z.input<typeof tickItemStageSchema>;

/** "Tick ‹stage› on N": each chosen item's stage of that name. */
export const tickStagesSchema = z.object({
  stageIds: z.array(id).min(1, "Pick at least one item.").max(BULK_MAX),
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
        message: "Close one item at a time, with a reason.",
      });
    }
  });
export type CarryDecideInput = z.input<typeof carryDecideSchema>;
