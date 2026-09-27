import { z } from "zod";

import { isISODate } from "@/core/time";

import {
  type FieldDefinition,
  LONG_TEXT_VALUE_MAX,
  RATING_MAX,
  TEXT_VALUE_MAX,
  splitDefinitions,
} from "./registry";

/**
 * The zod builder: one schema per definition, from its type and options (WORKFLOWS §4a). Empty
 * means "not filled": `undefined`, `null` and "" all read as no value, which a required field
 * refuses and an optional field leaves out of the stored object (an older record then shows "—"
 * and saves once filled). Values arrive as JSON from the form state or as strings from a
 * FormData, so numbers and booleans are coerced from their string forms.
 */

const REQUIRED = "This field is required.";

function emptyToUndefined(value: unknown): unknown {
  if (value === null || value === "") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const numberValue = z.preprocess(
  (value) => (typeof value === "string" ? Number(value.trim()) : value),
  z.number({ error: "Enter a number." }).finite("Enter a number."),
);

const booleanValue = z.preprocess(
  (value) => {
    if (value === "true" || value === "on" || value === "1") return true;
    if (value === "false" || value === "off" || value === "0") return false;
    return value;
  },
  z.boolean({ error: "Tick it or leave it clear." }),
);

const ratingValue = z.preprocess(
  (value) => (typeof value === "string" ? Number(value.trim()) : value),
  z
    .number({ error: `Pick 1 to ${RATING_MAX}.` })
    .int(`Pick 1 to ${RATING_MAX}.`)
    .min(1, `Pick 1 to ${RATING_MAX}.`)
    .max(RATING_MAX, `Pick 1 to ${RATING_MAX}.`),
);

const listValue = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      : value,
  z.array(z.string()),
);

/** The schema of one value, before the required / optional wrapper. */
export function valueSchema(definition: FieldDefinition): z.ZodType {
  const optionKeys = definition.options.map((option) => option.key);
  const choice = () =>
    optionKeys.length > 0
      ? z.enum(optionKeys as [string, ...string[]], { error: "Pick one of the options." })
      : z.never({ error: "This field has no options." });
  switch (definition.type) {
    case "text":
      return z.string().trim().max(TEXT_VALUE_MAX, `Keep it under ${TEXT_VALUE_MAX} characters.`);
    case "long_text":
      return z
        .string()
        .trim()
        .max(LONG_TEXT_VALUE_MAX, `Keep it under ${LONG_TEXT_VALUE_MAX} characters.`);
    case "number":
      return numberValue;
    case "date":
      return z
        .string()
        .trim()
        .refine((value) => isISODate(value), { message: "Pick a date." });
    case "datetime":
      return z
        .string()
        .trim()
        .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Pick a date and time." });
    case "checkbox":
      return booleanValue;
    case "select":
      return choice();
    case "multi_select":
      return listValue.pipe(
        z.array(choice()).max(optionKeys.length, "Pick each option once at most."),
      );
    case "url":
      return z
        .string()
        .trim()
        .max(TEXT_VALUE_MAX, "That link is too long.")
        .refine((value) => /^https?:\/\/\S+$/.test(value), {
          message: "Enter a full link starting with https://.",
        });
    case "email":
      return z.email("Enter a valid email address.").max(254, "That email address is too long.");
    case "phone":
      return z
        .string()
        .trim()
        .min(3, "That phone number is too short.")
        .max(32, "Keep the phone number under 32 characters.");
    case "color":
      return z
        .string()
        .trim()
        .regex(/^#[0-9a-fA-F]{6}$/, "A colour is a 6-digit hex value like #E11D48.")
        .transform((value) => value.toUpperCase());
    case "member":
      return z.uuid({ error: "Pick a team member." });
    case "rating":
      return ratingValue;
  }
}

/**
 * The object schema for the **active** definitions given: required keys must hold a value,
 * optional keys may be absent. Unknown keys are stripped (an archived or removed field is
 * carried separately by `validateCustomFields`).
 */
export function buildCustomFieldsSchema(definitions: readonly FieldDefinition[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const definition of splitDefinitions(definitions).active) {
    const value = valueSchema(definition);
    shape[definition.key] = definition.required
      ? z.preprocess(
          emptyToUndefined,
          z
            .unknown()
            .refine((v) => v !== undefined, { message: REQUIRED })
            // The refine leaves a present value; `pipe` wants that said in the type.
            .pipe(value as z.ZodType<unknown, NonNullable<unknown> | null>),
        )
      : z.preprocess(emptyToUndefined, value.optional());
  }
  return z.object(shape);
}

export type CustomFieldValues = Record<string, unknown>;

export type CustomFieldsValidation =
  { ok: true; values: CustomFieldValues } | { ok: false; fieldErrors: Record<string, string[]> };

/**
 * Validates the values a form sent against the definitions and returns what the record should
 * store: every active field's parsed value (absent when empty), plus the **previous** values of
 * archived definitions, which are kept, hidden from forms and shown read-only (kickoff 3). Keys
 * with no definition at all are dropped. Field errors are keyed `customFields.<key>`, the path
 * the forms show them under.
 */
export function validateCustomFields({
  definitions,
  values,
  previous = {},
}: {
  definitions: readonly FieldDefinition[];
  values: CustomFieldValues;
  previous?: CustomFieldValues;
}): CustomFieldsValidation {
  const parsed = buildCustomFieldsSchema(definitions).safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = `customFields.${issue.path.map(String).join(".") || "_form"}`;
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, fieldErrors };
  }
  const next: CustomFieldValues = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) next[key] = value;
  }
  for (const definition of splitDefinitions(definitions).archived) {
    if (definition.key in next) continue;
    const kept = previous[definition.key];
    if (kept !== undefined && kept !== null && kept !== "") next[definition.key] = kept;
  }
  return { ok: true, values: next };
}
