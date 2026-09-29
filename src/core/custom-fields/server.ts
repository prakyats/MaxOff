import "server-only";

import type { Json, Tables } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { AppError } from "@/core/errors";
import { nextPosition } from "@/core/lists";
import { systemClock } from "@/core/time";

import {
  type CustomFieldEntity,
  type FieldDefinition,
  type FieldOption,
  type FieldType,
  isCustomFieldEntity,
  isFieldType,
} from "./registry";
import { type CustomFieldValues, validateCustomFields } from "./schema";

/**
 * The definitions repository (CLAUDE.md rule 3: core/custom-fields owns `field_definitions`).
 * Everything runs under RLS as the signed-in member: the Owner sees every definition, an Admin
 * the global ones and those of their clients, Staff the task ones (4.1). Writes are decided by
 * `app.field_definition_writable()` (PERMISSIONS ¹ ²); a refused write matches no row.
 */

type Row = Tables<"field_definitions">;

function toOptions(value: unknown): FieldOption[] {
  if (!Array.isArray(value)) return [];
  const options: FieldOption[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && "key" in entry && "label" in entry) {
      options.push({ key: String(entry.key), label: String(entry.label) });
    }
  }
  return options;
}

function toDefinition(row: Row): FieldDefinition {
  if (!isCustomFieldEntity(row.entity) || !isFieldType(row.type)) {
    throw new AppError("INTERNAL", undefined, {
      cause: new Error(`field_definitions row ${row.id} has an unknown entity or type`),
    });
  }
  return {
    id: row.id,
    entity: row.entity,
    clientId: row.client_id,
    taskTypeId: row.task_type_id,
    key: row.key,
    label: row.label,
    helpText: row.help_text,
    type: row.type,
    options: toOptions(row.options),
    required: row.required,
    section: row.section,
    position: row.position,
    archivedAt: row.archived_at,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionsJson(options: readonly FieldOption[]): Json {
  return options.map((option) => ({ key: option.key, label: option.label }));
}

/**
 * The definitions that apply to a record: the entity's global rows plus, for a client-scoped
 * entity, the rows of that client, and for a task (4B) the rows of its task type. Archived ones
 * included (a view shows them read-only).
 */
export async function listDefinitions(
  entity: CustomFieldEntity,
  scope: { clientId?: string | null; taskTypeId?: string | null } = {},
): Promise<FieldDefinition[]> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("field_definitions")
    .select("*")
    .eq("entity", entity)
    .order("position", { ascending: true });
  query = scope.clientId
    ? query.or(`client_id.is.null,client_id.eq.${scope.clientId}`)
    : query.is("client_id", null);
  // A task field is company-wide or one task type's (DATA-MODEL §2, 4A): a task sees both. The
  // id is spliced into the filter, so it must be a uuid (callers pass a zod-checked one).
  if (scope.taskTypeId && !UUID.test(scope.taskTypeId)) {
    throw new AppError("VALIDATION", "Choose a task type from the list.");
  }
  if (entity === "task") {
    query = scope.taskTypeId
      ? query.or(`task_type_id.is.null,task_type_id.eq.${scope.taskTypeId}`)
      : query.is("task_type_id", null);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data.map(toDefinition);
}

/** Every definition of an entity the caller may see, global and client-scoped (the Settings screen). */
export async function listAllDefinitions(entity: CustomFieldEntity): Promise<FieldDefinition[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("entity", entity)
    .order("position", { ascending: true });
  if (error) throw error;
  return data.map(toDefinition);
}

export async function getDefinition(id: string): Promise<FieldDefinition | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toDefinition(data) : null;
}

export type DefinitionInput = {
  entity: CustomFieldEntity;
  clientId: string | null;
  /** A task field for one task type only (4C); null or absent = every task. */
  taskTypeId?: string | null;
  key: string;
  label: string;
  helpText: string | null;
  type: FieldType;
  options: FieldOption[];
  required: boolean;
  section: string | null;
};

/** Appends after the last definition of the entity and scope. Audited by the table's trigger. */
export async function createDefinition(input: DefinitionInput): Promise<FieldDefinition> {
  const supabase = await createServerSupabase();
  let lastQuery = supabase
    .from("field_definitions")
    .select("position")
    .eq("entity", input.entity)
    .order("position", { ascending: false })
    .limit(1);
  lastQuery = input.clientId
    ? lastQuery.eq("client_id", input.clientId)
    : lastQuery.is("client_id", null);
  lastQuery = input.taskTypeId
    ? lastQuery.eq("task_type_id", input.taskTypeId)
    : lastQuery.is("task_type_id", null);
  const { data: last, error: lastError } = await lastQuery.maybeSingle();
  if (lastError) throw lastError;

  const { data, error } = await supabase
    .from("field_definitions")
    .insert({
      entity: input.entity,
      client_id: input.clientId,
      task_type_id: input.taskTypeId ?? null,
      key: input.key,
      label: input.label,
      help_text: input.helpText,
      type: input.type,
      options: optionsJson(input.options),
      required: input.required,
      section: input.section,
      position: nextPosition(last?.position ?? null),
    })
    .select("*")
    .single();
  if (error) throw error;
  return toDefinition(data);
}

export type DefinitionPatch = {
  label: string;
  helpText: string | null;
  type: FieldType;
  options: FieldOption[];
  required: boolean;
  section: string | null;
};

const NOT_YOURS = "This field is not one you can edit.";

export async function updateDefinition(id: string, patch: DefinitionPatch): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("field_definitions")
    .update(
      {
        label: patch.label,
        help_text: patch.helpText,
        type: patch.type,
        options: optionsJson(patch.options),
        required: patch.required,
        section: patch.section,
      },
      { count: "exact" },
    )
    .eq("id", id);
  if (error) throw error;
  if (count === 0) throw new AppError("NOT_FOUND", NOT_YOURS);
}

/** Never deleted (invariant 9): archived definitions keep their values (WORKFLOWS §4a). */
export async function setDefinitionArchived(id: string, archived: boolean): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("field_definitions")
    .update({ archived_at: archived ? systemClock().toISOString() : null }, { count: "exact" })
    .eq("id", id);
  if (error) throw error;
  if (count === 0) throw new AppError("NOT_FOUND", NOT_YOURS);
}

/**
 * The server-side validation an action calls before writing a record (ARCHITECTURE §4.2 step
 * 3): loads the definitions that apply, validates, and throws a `VALIDATION` AppError with the
 * per-field messages so the form shows each next to its field. Returns what to store.
 */
export async function validateCustomFieldsFor(
  entity: CustomFieldEntity,
  values: CustomFieldValues,
  options: {
    clientId?: string | null;
    taskTypeId?: string | null;
    previous?: CustomFieldValues;
    /**
     * Defaults, not a record (a task template's, 4.6): each value is checked, but a required
     * field may be left empty, since the form that makes the record asks for it then.
     */
    skipRequired?: boolean;
  } = {},
): Promise<CustomFieldValues> {
  const found = await listDefinitions(entity, {
    clientId: options.clientId ?? null,
    taskTypeId: options.taskTypeId ?? null,
  });
  const definitions = options.skipRequired
    ? found.map((definition) => ({ ...definition, required: false }))
    : found;
  const result = validateCustomFields({
    definitions,
    values,
    ...(options.previous ? { previous: options.previous } : {}),
  });
  if (!result.ok) {
    throw new AppError("VALIDATION", "Check the custom fields.", {
      fieldErrors: result.fieldErrors,
    });
  }
  return result.values;
}
