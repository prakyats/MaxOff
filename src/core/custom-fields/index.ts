/**
 * core/custom-fields: the custom fields engine (ADR-0002, DATA-MODEL §2, WORKFLOWS §4a). This
 * barrel is client-safe (registry and the zod builder); the repository and the server-side
 * validation live in `@/core/custom-fields/server` (`server-only`), and the two components are
 * imported by file (`components/custom-fields-form`, `components/custom-fields-view`), never
 * from a barrel (ADR-0011 amendment).
 */
export {
  CLIENT_SCOPED_ENTITIES,
  CUSTOM_FIELD_ENTITIES,
  describeValue,
  ENTITY_LABELS,
  FIELD_HELP_MAX,
  FIELD_KEY_MAX,
  FIELD_KEY_PATTERN,
  FIELD_LABEL_MAX,
  FIELD_SECTION_MAX,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  hasOptions,
  isCustomFieldEntity,
  isFieldType,
  isSettingsEntity,
  keyFromLabel,
  OPTION_KEY_PATTERN,
  OPTION_LABEL_MAX,
  OPTIONS_MAX,
  optionKeyFromLabel,
  optionLinesOf,
  parseOptionLines,
  OWNER_ONLY_ENTITIES,
  RATING_MAX,
  SETTINGS_ENTITIES,
  splitDefinitions,
  type CustomFieldEntity,
  type FieldDefinition,
  type FieldOption,
  type FieldType,
  type SettingsEntity,
} from "./registry";
export {
  createDefinitionSchema,
  definitionArchiveSchema,
  updateDefinitionSchema,
  type CreateDefinitionInput,
  type DefinitionArchiveInput,
  type UpdateDefinitionInput,
} from "./definition-schema";
export {
  buildCustomFieldsSchema,
  validateCustomFields,
  valueSchema,
  type CustomFieldValues,
  type CustomFieldsValidation,
} from "./schema";
