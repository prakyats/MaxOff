"use client";

import type { FieldErrors } from "@/core/errors";
import { FormField } from "@/core/ui/composites/form-field";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import { Input } from "@/core/ui/primitives/input";
import { Label } from "@/core/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";

import {
  type FieldDefinition,
  LONG_TEXT_VALUE_MAX,
  RATING_MAX,
  splitDefinitions,
  TEXT_VALUE_MAX,
} from "../registry";
import { CustomFieldsView } from "./custom-fields-view";

export type CustomFieldValues = Record<string, unknown>;

/** A member option for `member` fields; the consumer passes the directory it may see. */
export type MemberOption = { id: string; name: string };

const NONE = "__none__";

function textOf(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function listOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * The typed inputs of a record's custom fields (WORKFLOWS §4a): one control per **active**
 * definition, grouped by section, values held by the parent (`values` / `onChange`) so the form
 * that owns the record saves them with the rest. A select stores the option **key**; a checkbox
 * a boolean; a number a number; everything else a string. Archived definitions are not offered:
 * their values show read-only under "Archived fields" (kickoff 3).
 *
 * Errors come back keyed `customFields.<key>` (`validateCustomFields`), the path a form's
 * `fieldErrors` carries them under.
 */
export function CustomFieldsForm({
  definitions,
  values,
  onChange,
  errors,
  members = [],
  disabled = false,
}: {
  definitions: readonly FieldDefinition[];
  values: CustomFieldValues;
  onChange: (next: CustomFieldValues) => void;
  errors?: FieldErrors | undefined;
  members?: readonly MemberOption[];
  disabled?: boolean;
}) {
  const { active, archived } = splitDefinitions(definitions);
  if (active.length === 0 && archived.length === 0) return null;

  function set(key: string, value: unknown) {
    const next = { ...values };
    if (value === undefined || value === "" || value === null) delete next[key];
    else next[key] = value;
    onChange(next);
  }

  const sections = new Map<string, FieldDefinition[]>();
  for (const definition of active) {
    const section = definition.section ?? "";
    sections.set(section, [...(sections.get(section) ?? []), definition]);
  }

  return (
    <div data-slot="custom-fields-form" className="flex flex-col gap-4">
      {[...sections.entries()].map(([section, fields]) => (
        <div key={section || "_"} className="flex flex-col gap-4">
          {section ? (
            <h3 className="text-muted-foreground text-sm font-medium">{section}</h3>
          ) : null}
          {fields.map((definition) => (
            <CustomFieldControl
              key={definition.id}
              definition={definition}
              value={values[definition.key]}
              onChange={(value) => set(definition.key, value)}
              error={errors?.[`customFields.${definition.key}`]}
              members={members}
              disabled={disabled}
            />
          ))}
        </div>
      ))}
      {archived.length > 0 ? (
        <CustomFieldsView definitions={archived} values={values} archivedOnly />
      ) : null}
    </div>
  );
}

function CustomFieldControl({
  definition,
  value,
  onChange,
  error,
  members,
  disabled,
}: {
  definition: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  error: readonly string[] | undefined;
  members: readonly MemberOption[];
  disabled: boolean;
}) {
  const name = `customFields.${definition.key}`;
  const label = definition.required ? `${definition.label} *` : definition.label;
  const hint = definition.helpText ?? undefined;

  if (definition.type === "checkbox") {
    // A checkbox is its own label row; FormField's label-above layout would float it.
    const checked = value === true;
    const id = `cf-${definition.id}`;
    return (
      <div className="flex flex-col gap-1.5" data-slot="custom-field" data-type="checkbox">
        <Label htmlFor={id} className="flex min-h-11 items-center gap-3">
          <Checkbox
            id={id}
            name={name}
            checked={checked}
            onCheckedChange={(next) => onChange(next === true)}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
          />
          <span>{label}</span>
        </Label>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
        {error?.[0] ? <p className="text-destructive text-xs">{error[0]}</p> : null}
      </div>
    );
  }

  return (
    <FormField label={label} hint={hint} error={error}>
      {(control) => {
        switch (definition.type) {
          case "long_text":
            return (
              <Textarea
                {...control}
                name={name}
                value={textOf(value)}
                onChange={(event) => onChange(event.target.value)}
                maxLength={LONG_TEXT_VALUE_MAX}
                rows={3}
                disabled={disabled}
              />
            );
          case "number":
            return (
              <Input
                {...control}
                name={name}
                type="number"
                inputMode="decimal"
                value={textOf(value)}
                onChange={(event) => onChange(event.target.value)}
                disabled={disabled}
              />
            );
          case "date":
            return (
              <Input
                {...control}
                name={name}
                type="date"
                value={textOf(value)}
                onChange={(event) => onChange(event.target.value)}
                disabled={disabled}
              />
            );
          case "datetime":
            return (
              <Input
                {...control}
                name={name}
                type="datetime-local"
                value={textOf(value)}
                onChange={(event) => onChange(event.target.value)}
                disabled={disabled}
              />
            );
          case "select":
            return (
              <Select
                value={textOf(value) || NONE}
                onValueChange={(next) => onChange(next === NONE ? "" : next)}
                disabled={disabled}
              >
                <SelectTrigger
                  id={control.id}
                  className="w-full"
                  aria-describedby={control["aria-describedby"]}
                  aria-invalid={control["aria-invalid"]}
                  name={name}
                >
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {!definition.required ? <SelectItem value={NONE}>None</SelectItem> : null}
                  {definition.options.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          case "multi_select": {
            const chosen = listOf(value);
            return (
              <div
                id={control.id}
                role="group"
                aria-describedby={control["aria-describedby"]}
                className="flex flex-col gap-1"
              >
                {definition.options.map((option) => {
                  const id = `cf-${definition.id}-${option.key}`;
                  const on = chosen.includes(option.key);
                  return (
                    <Label
                      key={option.key}
                      htmlFor={id}
                      className="flex min-h-11 items-center gap-3"
                    >
                      <Checkbox
                        id={id}
                        name={`${name}[]`}
                        checked={on}
                        disabled={disabled}
                        onCheckedChange={(next) =>
                          onChange(
                            next === true
                              ? [...chosen, option.key]
                              : chosen.filter((key) => key !== option.key),
                          )
                        }
                      />
                      <span>{option.label}</span>
                    </Label>
                  );
                })}
              </div>
            );
          }
          case "member":
            return (
              <Select
                value={textOf(value) || NONE}
                onValueChange={(next) => onChange(next === NONE ? "" : next)}
                disabled={disabled}
              >
                <SelectTrigger
                  id={control.id}
                  className="w-full"
                  aria-describedby={control["aria-describedby"]}
                  aria-invalid={control["aria-invalid"]}
                  name={name}
                >
                  <SelectValue placeholder="Choose a person" />
                </SelectTrigger>
                <SelectContent>
                  {!definition.required ? <SelectItem value={NONE}>Nobody</SelectItem> : null}
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          case "rating":
            return (
              <Select
                value={textOf(value) || NONE}
                onValueChange={(next) => onChange(next === NONE ? "" : Number(next))}
                disabled={disabled}
              >
                <SelectTrigger
                  id={control.id}
                  className="w-full"
                  aria-describedby={control["aria-describedby"]}
                  aria-invalid={control["aria-invalid"]}
                  name={name}
                >
                  <SelectValue placeholder="Rate" />
                </SelectTrigger>
                <SelectContent>
                  {!definition.required ? <SelectItem value={NONE}>Not rated</SelectItem> : null}
                  {Array.from({ length: RATING_MAX }, (_, index) => index + 1).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} / {RATING_MAX}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          case "color":
            return (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`${definition.label} swatch`}
                  value={/^#[0-9a-fA-F]{6}$/.test(textOf(value)) ? textOf(value) : "#000000"}
                  onChange={(event) => onChange(event.target.value.toUpperCase())}
                  disabled={disabled}
                  className="size-11 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
                />
                <Input
                  {...control}
                  name={name}
                  value={textOf(value)}
                  onChange={(event) => onChange(event.target.value)}
                  placeholder="#E11D48"
                  maxLength={7}
                  disabled={disabled}
                />
              </div>
            );
          case "url":
          case "email":
          case "phone":
          case "text":
            return (
              <Input
                {...control}
                name={name}
                type={
                  definition.type === "url"
                    ? "url"
                    : definition.type === "email"
                      ? "email"
                      : definition.type === "phone"
                        ? "tel"
                        : "text"
                }
                inputMode={definition.type === "phone" ? "tel" : undefined}
                value={textOf(value)}
                onChange={(event) => onChange(event.target.value)}
                maxLength={TEXT_VALUE_MAX}
                disabled={disabled}
              />
            );
        }
      }}
    </FormField>
  );
}
