import { cn } from "@/core/lib/utils";

import { describeValue, type FieldDefinition, splitDefinitions } from "../registry";

export type CustomFieldValues = Record<string, unknown>;

/**
 * The read-only side of a record's custom fields: label and value rows, grouped by section, in the
 * built-in fields' style (`EditableRecord`: a muted `text-sm` label over a medium value) and with
 * their empty word, "Not added" (P1; an older record saves once filled, WORKFLOWS §4a). Archived definitions
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
        <dl key={section || "_"} className="flex flex-col gap-3 text-sm">
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
          <dl className="flex flex-col gap-3 text-sm">
            {archivedWithValues.map((definition) => (
              <Row key={definition.id} definition={definition} value={values[definition.key]} />
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The active fields as cells of a caller's field grid (PP-project-2: a project's fields flow into
 * the same Details cells as its built-in ones): each a `<div>` of a small label over its value,
 * with `cellClassName`, to sit inside the caller's `<dl>`. A field's section names the cell
 * ("Shoot · Location"). Archived fields with values stay apart (`CustomFieldsView archivedOnly`).
 */
export function CustomFieldCells({
  definitions,
  values,
  cellClassName,
}: {
  definitions: readonly FieldDefinition[];
  values: CustomFieldValues;
  cellClassName?: string;
}) {
  const { active } = splitDefinitions(definitions);
  return (
    <>
      {active.map((definition) => (
        <Row
          key={definition.id}
          definition={definition}
          value={values[definition.key]}
          cell
          className={cellClassName}
        />
      ))}
    </>
  );
}

function Row({
  definition,
  value,
  cell = false,
  className,
}: {
  definition: FieldDefinition;
  value: unknown;
  /** A grid cell: the small label (12 px) over a regular value, as the built-in cells read. */
  cell?: boolean;
  className?: string | undefined;
}) {
  const text = describeValue(definition, value);
  return (
    <div data-slot="custom-field-value" data-key={definition.key} className={className}>
      <dt className={cell ? "text-muted-foreground text-xs" : "text-muted-foreground"}>
        {cell && definition.section
          ? `${definition.section} · ${definition.label}`
          : definition.label}
      </dt>
      <dd className={cn("break-words", !cell && "font-medium")}>
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
          <a
            href={text}
            target="_blank"
            rel="noreferrer"
            className="pressable-row break-all underline"
          >
            {text}
          </a>
        ) : text === null ? (
          <span className="text-muted-foreground font-normal">Not added</span>
        ) : (
          text
        )}
      </dd>
    </div>
  );
}
