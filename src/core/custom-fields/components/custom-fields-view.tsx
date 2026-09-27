import { cn } from "@/core/lib/utils";

import { describeValue, type FieldDefinition, splitDefinitions } from "../registry";

export type CustomFieldValues = Record<string, unknown>;

/**
 * The read-only side of a record's custom fields: label and value rows, grouped by section, a
 * "—" for an empty one (an older record saves once filled, WORKFLOWS §4a). Archived definitions
 * that still hold a value sit apart under "Archived fields" (kickoff 3); with `archivedOnly` the
 * component renders just that section (the form uses it under its inputs). A server component:
 * no state, no handlers.
 */
export function CustomFieldsView({
  definitions,
  values,
  archivedOnly = false,
  className,
}: {
  definitions: readonly FieldDefinition[];
  values: CustomFieldValues;
  archivedOnly?: boolean;
  className?: string;
}) {
  const { active, archived } = splitDefinitions(definitions);
  const archivedWithValues = archived.filter(
    (definition) => describeValue(definition, values[definition.key]) !== null,
  );
  const live = archivedOnly ? [] : active;
  if (live.length === 0 && archivedWithValues.length === 0) return null;

  const sections = new Map<string, FieldDefinition[]>();
  for (const definition of live) {
    const section = definition.section ?? "";
    sections.set(section, [...(sections.get(section) ?? []), definition]);
  }

  return (
    <div data-slot="custom-fields-view" className={cn("flex flex-col gap-4", className)}>
      {[...sections.entries()].map(([section, fields]) => (
        <dl key={section || "_"} className="flex flex-col gap-3">
          {section ? (
            <dt className="text-muted-foreground text-sm font-medium">{section}</dt>
          ) : null}
          {fields.map((definition) => (
            <Row key={definition.id} definition={definition} value={values[definition.key]} />
          ))}
        </dl>
      ))}
      {archivedWithValues.length > 0 ? (
        <section data-slot="archived-fields" className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-sm font-medium">Archived fields</h3>
          <p className="text-muted-foreground text-xs">
            These fields were archived; their values are kept and can no longer be edited.
          </p>
          <dl className="flex flex-col gap-3">
            {archivedWithValues.map((definition) => (
              <Row key={definition.id} definition={definition} value={values[definition.key]} />
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function Row({ definition, value }: { definition: FieldDefinition; value: unknown }) {
  const text = describeValue(definition, value);
  return (
    <div data-slot="custom-field-value" data-key={definition.key} className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{definition.label}</dt>
      <dd className={cn("text-sm", text === null && "text-muted-foreground")}>
        {definition.type === "color" && text ? (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="border-border inline-block size-4 rounded-sm border"
              style={{ backgroundColor: text }}
            />
            {text}
          </span>
        ) : definition.type === "url" && text ? (
          <a href={text} target="_blank" rel="noreferrer" className="break-all underline">
            {text}
          </a>
        ) : (
          (text ?? "—")
        )}
      </dd>
    </div>
  );
}
