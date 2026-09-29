import type { Enums } from "@/core/db";

/**
 * Custom fields (ADR-0002, DATA-MODEL §2, WORKFLOWS §4a): definitions are rows the Owner (or,
 * for one client, its Admin) edits in Settings; every record with a `custom_fields` column
 * stores values keyed by definition key. Code knows the field types and the entities it renders
 * a form for, never the fields themselves. This file is client-safe (no zod, no database).
 */

export type FieldType = Enums<"field_type">;

export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "date",
  "datetime",
  "checkbox",
  "select",
  "multi_select",
  "url",
  "email",
  "phone",
  "color",
  "member",
  "rating",
] as const satisfies readonly FieldType[];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  date: "Date",
  datetime: "Date and time",
  checkbox: "Checkbox",
  select: "Choice",
  multi_select: "Multiple choice",
  url: "Link",
  email: "Email",
  phone: "Phone",
  color: "Colour",
  member: "Team member",
  rating: "Rating (1 to 5)",
};

/** The entities that can carry custom fields (DATA-MODEL §2). */
export const CUSTOM_FIELD_ENTITIES = ["client", "contact", "project", "item", "task"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

export const ENTITY_LABELS: Record<CustomFieldEntity, { singular: string; plural: string }> = {
  client: { singular: "Client", plural: "Clients" },
  contact: { singular: "Contact", plural: "Contacts" },
  project: { singular: "Project", plural: "Projects" },
  item: { singular: "Item", plural: "Items" },
  task: { singular: "Task", plural: "Tasks" },
};

/**
 * The entities Settings → Custom fields edits: client and contact for everyone with
 * `lists.manage` (global rows Owner-only, client-scoped rows by that client's Admin), project
 * and item Owner-only with no consumer yet (3.2), and task (4B): company-wide task fields for
 * everyone with `lists.manage` (PERMISSIONS ³: task fields stay `lists.manage`). A field for one
 * task type is stored and applied (4A) but not yet offered here.
 */
export const SETTINGS_ENTITIES = ["client", "contact", "project", "item", "task"] as const;
export type SettingsEntity = (typeof SETTINGS_ENTITIES)[number];

/** Entities whose definitions may be scoped to one client (kickoff 3). */
export const CLIENT_SCOPED_ENTITIES = ["client", "contact"] as const;

/**
 * The field form's reminder that money stays out of custom fields (owner decision 2026-09-27,
 * phase 3 review, PRODUCT §4.16): shown for a number field, and for any client or contact field,
 * because Admins read those. Null when it does not apply.
 */
export function adminVisibleNote(entity: string, type: FieldType): string | null {
  return type === "number" || (CLIENT_SCOPED_ENTITIES as readonly string[]).includes(entity)
    ? "Admins can see this field. Amounts belong in project billing (Owner only)."
    : null;
}

/** Entities whose definitions only the Owner writes, globally (PERMISSIONS ¹). */
export const OWNER_ONLY_ENTITIES = ["project", "item"] as const;

export function isCustomFieldEntity(value: unknown): value is CustomFieldEntity {
  return typeof value === "string" && (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(value);
}

export function isSettingsEntity(value: unknown): value is SettingsEntity {
  return typeof value === "string" && (SETTINGS_ENTITIES as readonly string[]).includes(value);
}

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

export type FieldOption = { key: string; label: string };

/** A definition as the app reads it (camelCase over the `field_definitions` row). */
export type FieldDefinition = {
  id: string;
  entity: CustomFieldEntity;
  clientId: string | null;
  taskTypeId: string | null;
  key: string;
  label: string;
  helpText: string | null;
  type: FieldType;
  options: FieldOption[];
  required: boolean;
  section: string | null;
  position: string;
  archivedAt: string | null;
};

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const OPTION_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const FIELD_LABEL_MAX = 80;
export const FIELD_HELP_MAX = 300;
export const FIELD_SECTION_MAX = 60;
export const FIELD_KEY_MAX = 40;
export const OPTION_LABEL_MAX = 80;
export const OPTIONS_MAX = 50;
export const TEXT_VALUE_MAX = 500;
export const LONG_TEXT_VALUE_MAX = 5000;
export const RATING_MAX = 5;

/**
 * A key from a label: "Shoot days (planned)" → "shoot_days_planned". Fixed once saved (the
 * values are stored under it); a renamed label rewrites nothing.
 */
export function keyFromLabel(label: string): string {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, FIELD_KEY_MAX);
  return key.replace(/_+$/, "");
}

/** A select option's key from its label: "Gold tier" → "gold-tier". */
export function optionKeyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, FIELD_KEY_MAX);
}

/** Types whose value is a choice among the definition's options. */
export function hasOptions(type: FieldType): boolean {
  return type === "select" || type === "multi_select";
}

/** Live definitions first by section and position; archived ones apart (WORKFLOWS §4a). */
export function splitDefinitions(definitions: readonly FieldDefinition[]): {
  active: FieldDefinition[];
  archived: FieldDefinition[];
} {
  const byPosition = (a: FieldDefinition, b: FieldDefinition) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
  return {
    active: definitions.filter((d) => d.archivedAt === null).sort(byPosition),
    archived: definitions.filter((d) => d.archivedAt !== null).sort(byPosition),
  };
}

/** The label of a stored value, for read-only views and change descriptions. */
export function describeValue(definition: FieldDefinition, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  switch (definition.type) {
    case "checkbox":
      return value === true ? "Yes" : "No";
    case "select": {
      const option = definition.options.find((o) => o.key === value);
      return option?.label ?? String(value);
    }
    case "multi_select": {
      if (!Array.isArray(value)) return null;
      const labels = value.map(
        (key) => definition.options.find((o) => o.key === key)?.label ?? String(key),
      );
      return labels.length > 0 ? labels.join(", ") : null;
    }
    case "rating":
      return `${String(value)} / ${RATING_MAX}`;
    default:
      return String(value);
  }
}

/**
 * Options as the Settings form types them: one per line, "Label" or "key | Label". A line
 * without a key gets one from its label, so the Owner types names and the stored keys stay
 * stable across renames (kickoff 3: a select stores the option key).
 */
export function parseOptionLines(text: string): { options: FieldOption[]; error?: string } {
  const options: FieldOption[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [first, ...rest] = line.split("|");
    const hasKey = rest.length > 0;
    const label = (hasKey ? rest.join("|") : (first ?? "")).trim();
    const key = hasKey ? (first ?? "").trim().toLowerCase() : optionKeyFromLabel(label);
    if (!label || label.length > OPTION_LABEL_MAX) {
      return { options, error: `Each option needs a label under ${OPTION_LABEL_MAX} characters.` };
    }
    if (!OPTION_KEY_PATTERN.test(key)) {
      return {
        options,
        error: `"${line}" needs a key of letters, digits, - or _ (or leave the key out).`,
      };
    }
    if (seen.has(key)) return { options, error: `The option key "${key}" appears twice.` };
    seen.add(key);
    options.push({ key, label });
  }
  if (options.length > OPTIONS_MAX) return { options, error: `Up to ${OPTIONS_MAX} options.` };
  return { options };
}

/** The lines for the form, from stored options: "key | Label". */
export function optionLinesOf(options: readonly FieldOption[]): string {
  return options.map((option) => `${option.key} | ${option.label}`).join("\n");
}
