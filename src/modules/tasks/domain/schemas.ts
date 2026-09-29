import { z } from "zod";

import {
  ASSIGNEES_MAX,
  COMMENT_MAX,
  DESCRIPTION_MAX,
  LOCATION_MAX,
  NOTE_MAX,
  PURPOSE_MAX,
  REASON_MAX,
  STAGE_NAME_MAX,
  STAGES_MAX,
  TITLE_MAX,
} from "./limits";
import { PRIORITIES } from "./types";

/**
 * What the task actions accept (ARCHITECTURE §4.2: zod first). The transition functions check
 * every rule again (4A); these keep a malformed request from reaching them and give each field
 * its own message.
 */

const instant = z.iso.datetime({ offset: true, error: "Pick a date and a time." });
const isoDate = z.iso.date({ error: "Pick a date." });

const title = z
  .string()
  .trim()
  .min(1, "Give the task a title.")
  .max(TITLE_MAX, `Keep the title under ${TITLE_MAX} characters.`);
const description = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX, `Keep the description under ${DESCRIPTION_MAX} characters.`)
  .nullable();
const location = z
  .string()
  .trim()
  .max(LOCATION_MAX, `Keep the location under ${LOCATION_MAX} characters.`)
  .nullable();
const purpose = z
  .string()
  .trim()
  .max(PURPOSE_MAX, `Keep the purpose under ${PURPOSE_MAX} characters.`)
  .nullable();
const assigneeIds = z
  .array(z.uuid())
  .min(1, "Assign at least one person.")
  .max(ASSIGNEES_MAX, `Up to ${ASSIGNEES_MAX} people.`);
const customFields = z.record(z.string(), z.unknown());

/** A warning the person proceeded past (WORKFLOWS §3.1), recorded by the function. */
export const warningsSchema = z
  .array(
    z.object({
      kind: z.enum(["workload", "overlap", "on_leave"]),
      memberId: z.uuid(),
      details: z.record(z.string(), z.union([z.string(), z.number()])),
    }),
  )
  .max(ASSIGNEES_MAX * 3);
export type WarningsInput = z.input<typeof warningsSchema>;

export const createTaskSchema = z.object({
  title,
  description,
  taskTypeId: z.uuid({ error: "Choose a task type." }),
  clientId: z.uuid().nullable(),
  priority: z.enum(PRIORITIES, { error: "Pick a priority." }),
  dueAt: instant,
  eventDate: isoDate.nullable(),
  eventStartAt: instant.nullable(),
  eventEndAt: instant.nullable(),
  location,
  purpose,
  assigneeIds,
  primaryOwnerId: z.uuid({ error: "Choose the primary owner." }),
  /** The Owner's approving Admin; null = the Owner approves directly. An Admin's is themselves. */
  approvingAdminId: z.uuid().nullable(),
  stages: z
    .array(
      z
        .string()
        .trim()
        .min(1, "Name each stage, or remove it.")
        .max(STAGE_NAME_MAX, `Keep each stage under ${STAGE_NAME_MAX} characters.`),
    )
    .max(STAGES_MAX, `Up to ${STAGES_MAX} stages.`),
  customFields,
  warnings: warningsSchema,
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

/**
 * An edit (`task_update_assignment`, 4A mechanics 4): only the fields that changed. `taskTypeId`
 * is the type the task will have, so its custom fields are checked against the right definitions.
 */
export const updateTaskSchema = z.object({
  taskId: z.uuid(),
  taskTypeId: z.uuid(),
  changes: z
    .object({
      title,
      description,
      taskTypeId: z.uuid(),
      clientId: z.uuid().nullable(),
      priority: z.enum(PRIORITIES),
      dueAt: instant,
      eventDate: isoDate.nullable(),
      eventStartAt: instant.nullable(),
      eventEndAt: instant.nullable(),
      location,
      purpose,
      assigneeIds,
      primaryOwnerId: z.uuid(),
      customFields,
    })
    .partial()
    .strict()
    .refine((changes) => Object.keys(changes).length > 0, { message: "Nothing changed." }),
  warnings: warningsSchema,
});
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

/** The days a warning check reads (the deadline's and the event's), for the people picked. */
export const availabilitySchema = z.object({
  memberIds: z.array(z.uuid()).min(1).max(ASSIGNEES_MAX),
  days: z.array(isoDate).min(1).max(2),
});
export type AvailabilityInput = z.input<typeof availabilitySchema>;

/** A worker's action: for themselves (null) or for a freelancer they coordinate (ADR-0013). */
export const actingSchema = z.object({
  taskId: z.uuid(),
  onBehalfOf: z.uuid().nullable(),
});
export type ActingInput = z.input<typeof actingSchema>;

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullable()
    .transform((value) => (value ? value : null));

export const submitDoneSchema = z.object({
  taskId: z.uuid(),
  note: optionalText(NOTE_MAX, `Keep the note under ${NOTE_MAX} characters.`),
  lateReason: optionalText(REASON_MAX, `Keep the reason under ${REASON_MAX} characters.`),
  onBehalfOf: z.uuid().nullable(),
});
export type SubmitDoneInput = z.input<typeof submitDoneSchema>;

const reason = z
  .string()
  .trim()
  .min(3, "Please write a few more words.")
  .max(REASON_MAX, `Keep it under ${REASON_MAX} characters.`);

export const reviewSchema = z.discriminatedUnion("decision", [
  z.object({ taskId: z.uuid(), decision: z.literal("approved") }),
  z.object({ taskId: z.uuid(), decision: z.literal("rejected"), reason }),
]);
export type ReviewInput = z.input<typeof reviewSchema>;

/** Cancel and reopen both need a reason (WORKFLOWS §3.1). */
export const reasonSchema = z.object({ taskId: z.uuid(), reason });
export type ReasonInput = z.input<typeof reasonSchema>;

export const setApproverSchema = z.object({
  taskId: z.uuid(),
  approvingAdminId: z.uuid().nullable(),
});
export type SetApproverInput = z.input<typeof setApproverSchema>;

export const tickStageSchema = z.object({
  taskId: z.uuid(),
  stageId: z.uuid(),
  done: z.boolean(),
  onBehalfOf: z.uuid().nullable(),
});
export type TickStageInput = z.input<typeof tickStageSchema>;

export const addStageSchema = z.object({
  taskId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Name the stage.")
    .max(STAGE_NAME_MAX, `Keep it under ${STAGE_NAME_MAX} characters.`),
});
export type AddStageInput = z.input<typeof addStageSchema>;

export const removeStageSchema = z.object({ taskId: z.uuid(), stageId: z.uuid() });
export type RemoveStageInput = z.input<typeof removeStageSchema>;

export const commentSchema = z.object({
  taskId: z.uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(COMMENT_MAX, `Keep it under ${COMMENT_MAX} characters.`),
  onBehalfOf: z.uuid().nullable(),
});
export type CommentInput = z.input<typeof commentSchema>;
