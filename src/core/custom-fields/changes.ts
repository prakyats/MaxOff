import { type ChangeSubject, describeChange } from "@/core/ui/edit/changes";

import { describeValue, type FieldDefinition, splitDefinitions } from "./registry";

/**
 * The confirmation's lines for a record's custom fields (3.4, the edit pattern): each active
 * field whose value reads differently, named by its label and compared as the screen shows it
 * (an option's label, "Yes"/"No", "4 / 5"), so a number typed back as the same text is no
 * change. Archived fields are read-only and never differ.
 */
export function customFieldChanges(
  definitions: readonly FieldDefinition[],
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  subject: ChangeSubject,
): string[] {
  return splitDefinitions(definitions).active.flatMap((definition) => {
    const from = describeValue(definition, before[definition.key]) ?? "";
    const to = describeValue(definition, after[definition.key]) ?? "";
    if (from.trim() === to.trim()) return [];
    return [describeChange({ name: definition.key, from, to }, definition.label, subject)];
  });
}
