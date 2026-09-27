"use client";

import type { EditableExtra } from "@/core/ui/composites/editable-record";
import type { ChangeSubject } from "@/core/ui/edit/changes";

import { customFieldChanges } from "../changes";
import type { FieldDefinition } from "../registry";
import { CustomFieldsForm, type CustomFieldValues, type MemberOption } from "./custom-fields-form";
import { CustomFieldsView } from "./custom-fields-view";

/**
 * A record's custom fields as a part of its `EditableRecord` (3.4): the typed inputs in edit
 * mode (`CustomFieldsForm`), the values in read mode (`CustomFieldsView`), and one named line
 * per change in the save confirmation. Saved with the record's own fields, through its action,
 * which validates them against the definitions (`validateCustomFieldsFor`).
 */
export function customFieldsExtra({
  definitions,
  values,
  subject,
  members,
}: {
  definitions: readonly FieldDefinition[];
  values: CustomFieldValues;
  subject: ChangeSubject;
  members?: readonly MemberOption[];
}): EditableExtra<CustomFieldValues> | undefined {
  if (definitions.length === 0) return undefined;
  return {
    value: values,
    changes: (before, after) => customFieldChanges(definitions, before, after, subject),
    edit: ({ value, onChange, errors }) => (
      <CustomFieldsForm
        definitions={definitions}
        values={value}
        onChange={onChange}
        errors={errors}
        {...(members ? { members } : {})}
      />
    ),
    read: (value) => <CustomFieldsView definitions={definitions} values={value} />,
  };
}
