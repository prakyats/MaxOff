import { z } from "zod";

import {
  FIELD_HELP_MAX,
  FIELD_KEY_PATTERN,
  FIELD_LABEL_MAX,
  FIELD_SECTION_MAX,
  FIELD_TYPES,
  type FieldOption,
  hasOptions,
  parseOptionLines,
  scopeKindOf,
  SETTINGS_ENTITIES,
} from "./registry";

/**
 * What the Settings → Custom fields form sends (3.2). Options arrive as lines ("Label" or
 * "key | Label", `parseOptionLines`); a non-choice type stores none.
 */

function optionalText(max: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => (value ? value : null));
}

const optionsText = z
  .string()
  .optional()
  .default("")
  .transform((text, ctx) => {
    const { options, error } = parseOptionLines(text);
    if (error) {
      ctx.addIssue({ code: "custom", message: error });
      return z.NEVER;
    }
    return options;
  });

const base = {
  label: z
    .string()
    .trim()
    .min(1, "A label is required.")
    .max(FIELD_LABEL_MAX, `Keep the label under ${FIELD_LABEL_MAX} characters.`),
  type: z.enum(FIELD_TYPES, { error: "Choose a type." }),
  optionsText,
  required: z
    .union([z.boolean(), z.literal("on"), z.literal("off"), z.literal("")])
    .optional()
    .transform((value) => value === true || value === "on"),
  helpText: optionalText(FIELD_HELP_MAX, `Keep the help under ${FIELD_HELP_MAX} characters.`),
  section: optionalText(
    FIELD_SECTION_MAX,
    `Keep the section under ${FIELD_SECTION_MAX} characters.`,
  ),
};

function checkOptions(
  data: { type: (typeof FIELD_TYPES)[number]; optionsText: FieldOption[] },
  ctx: z.RefinementCtx,
) {
  if (hasOptions(data.type) && data.optionsText.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["optionsText"],
      message: "Add at least one option, one per line.",
    });
  }
}

export const createDefinitionSchema = z
  .object({
    entity: z.enum(SETTINGS_ENTITIES, { error: "Choose what the field is for." }),
    /** "" = every client (global, Owner-only); an id = that client only. */
    clientId: z
      .union([z.uuid(), z.literal("")])
      .optional()
      .transform((value) => (value ? value : null)),
    /** A task field: "" = every task; an id = that task type only (4C). */
    taskTypeId: z
      .union([z.uuid(), z.literal("")])
      .optional()
      .transform((value) => (value ? value : null)),
    key: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        FIELD_KEY_PATTERN,
        "A key is lower-case letters, digits and underscores, starting with a letter.",
      ),
    ...base,
  })
  .superRefine(checkOptions)
  .superRefine((data, ctx) => {
    // One scope, and only the one the entity has (the table's field_definitions_scope check).
    if (data.clientId && scopeKindOf(data.entity) !== "client") {
      ctx.addIssue({
        code: "custom",
        path: ["clientId"],
        message: "Only a client or contact field applies to one client.",
      });
    }
    if (data.taskTypeId && scopeKindOf(data.entity) !== "task_type") {
      ctx.addIssue({
        code: "custom",
        path: ["taskTypeId"],
        message: "Only a task field applies to one task type.",
      });
    }
  })
  .transform(({ optionsText, ...rest }) => ({
    ...rest,
    options: hasOptions(rest.type) ? optionsText : [],
  }));
export type CreateDefinitionInput = z.input<typeof createDefinitionSchema>;

export const updateDefinitionSchema = z
  .object({ definitionId: z.uuid(), ...base })
  .superRefine(checkOptions)
  .transform(({ optionsText, ...rest }) => ({
    ...rest,
    options: hasOptions(rest.type) ? optionsText : [],
  }));
export type UpdateDefinitionInput = z.input<typeof updateDefinitionSchema>;

export const definitionArchiveSchema = z.object({
  definitionId: z.uuid(),
  archived: z.boolean(),
});
export type DefinitionArchiveInput = z.input<typeof definitionArchiveSchema>;
