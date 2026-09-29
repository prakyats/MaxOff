"use client";

import { type FormEvent, useState } from "react";

import {
  adminVisibleNote,
  CLIENT_SCOPED_ENTITIES,
  FIELD_HELP_MAX,
  FIELD_KEY_MAX,
  FIELD_LABEL_MAX,
  FIELD_SECTION_MAX,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  type FieldDefinition,
  type FieldType,
  hasOptions,
  isFieldType,
  keyFromLabel,
  optionLinesOf,
  type SettingsEntity,
} from "@/core/custom-fields";
import type { Result, ResultError } from "@/core/errors";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
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
import { describeError, toastResult } from "@/core/ui/toast";

import { createFieldDefinition, updateFieldDefinition } from "../actions/custom-fields";

export type ScopeOption = { id: string; name: string };

const GLOBAL = "__global__";

/**
 * Add or edit one custom field definition (3.2, WORKFLOWS §4a). A bottom sheet on a phone. The
 * key follows the label until it is typed by hand, and is fixed once saved (values are stored
 * under it); the scope is fixed too. The type stays editable until a record holds a value, and
 * the database says so when it refuses (kickoff 3). Mounted fresh per definition (`key=` at the
 * call site) so the fields start from the right values.
 */
export function FieldDefinitionDialog({
  entity,
  definition,
  scopes,
  canGlobal,
  defaultScope,
  onClose,
}: {
  entity: SettingsEntity;
  /** Editing this one; undefined = adding. */
  definition?: FieldDefinition;
  /** The clients a field may be scoped to (the Owner: every client; an Admin: theirs). */
  scopes: readonly ScopeOption[];
  /** May a field apply to every client? Global rows are the Owner's (PERMISSIONS ²). */
  canGlobal: boolean;
  defaultScope: string | null;
  onClose: () => void;
}) {
  const scoped = (CLIENT_SCOPED_ENTITIES as readonly string[]).includes(entity);
  const editing = definition !== undefined;
  const [label, setLabel] = useState(definition?.label ?? "");
  const [key, setKey] = useState(definition?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(editing);
  const [type, setType] = useState<FieldType>(definition?.type ?? "text");
  const [optionsText, setOptionsText] = useState(optionLinesOf(definition?.options ?? []));
  const [required, setRequired] = useState(definition?.required ?? false);
  const [helpText, setHelpText] = useState(definition?.helpText ?? "");
  const [section, setSection] = useState(definition?.section ?? "");
  const [scope, setScope] = useState<string>(
    definition
      ? (definition.clientId ?? GLOBAL)
      : (defaultScope ?? (canGlobal ? GLOBAL : (scopes[0]?.id ?? GLOBAL))),
  );
  const [error, setError] = useState<ResultError | null>(null);
  const action = useAction(
    async () => {
      const shared = { label, type, optionsText, required, helpText, section };
      const result: Result<unknown> = editing
        ? await updateFieldDefinition({ definitionId: definition.id, ...shared })
        : await createFieldDefinition({
            entity,
            clientId: scoped && scope !== GLOBAL ? scope : "",
            key,
            ...shared,
          });
      if (result.ok) {
        toastResult(result, { success: editing ? "Field saved" : "Field added" });
        onClose();
      } else {
        setError(result.error);
      }
    },
    { creates: !editing },
  );
  const { pending } = action;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run();
  }

  const summary = error && !error.fieldErrors ? describeError(error) : null;
  const scopeName = scopes.find((s) => s.id === scope)?.name;

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <form
          onSubmit={submit}
          noValidate
          className="flex flex-col gap-4"
          data-slot="field-definition-form"
        >
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${definition.label}` : "Add a field"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "The key and the scope stay as they are; the type can change until a record holds a value."
                : scoped
                  ? "A field for every client, or for one client only."
                  : "Only the Owner defines these fields."}
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}

          {scoped ? (
            <FormField label="Applies to" error={error?.fieldErrors?.clientId}>
              {(control) =>
                editing ? (
                  <Input
                    {...control}
                    value={definition.clientId ? (scopeName ?? "One client") : "Every client"}
                    readOnly
                    disabled
                  />
                ) : (
                  <Select value={scope} onValueChange={setScope}>
                    <SelectTrigger
                      id={control.id}
                      className="w-full"
                      aria-describedby={control["aria-describedby"]}
                      aria-invalid={control["aria-invalid"]}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {canGlobal ? <SelectItem value={GLOBAL}>Every client</SelectItem> : null}
                      {scopes.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name} only
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              }
            </FormField>
          ) : null}

          <FormField label="Label" error={error?.fieldErrors?.label}>
            {(control) => (
              <Input
                {...control}
                name="label"
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value);
                  if (!keyTouched) setKey(keyFromLabel(event.target.value));
                }}
                maxLength={FIELD_LABEL_MAX}
                autoFocus
                required
              />
            )}
          </FormField>

          <FormField
            label="Key"
            hint={
              editing
                ? "Fixed: values are stored under it."
                : "How the value is stored. Fixed once saved."
            }
            error={error?.fieldErrors?.key}
          >
            {(control) => (
              <Input
                {...control}
                name="key"
                value={key}
                onChange={(event) => {
                  setKeyTouched(true);
                  setKey(event.target.value);
                }}
                maxLength={FIELD_KEY_MAX}
                readOnly={editing}
                disabled={editing}
                className="font-mono"
                required
              />
            )}
          </FormField>

          <FormField
            label="Type"
            error={error?.fieldErrors?.type}
            hint={adminVisibleNote(entity, type) ?? undefined}
          >
            {(control) => (
              <Select value={type} onValueChange={(next) => isFieldType(next) && setType(next)}>
                <SelectTrigger
                  id={control.id}
                  className="w-full"
                  aria-describedby={control["aria-describedby"]}
                  aria-invalid={control["aria-invalid"]}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {FIELD_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          {hasOptions(type) ? (
            <FormField
              label="Options"
              hint='One per line. "Gold" stores the key gold; "g | Gold" keeps the key g when the label changes.'
              error={error?.fieldErrors?.optionsText}
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="optionsText"
                  value={optionsText}
                  onChange={(event) => setOptionsText(event.target.value)}
                  rows={4}
                  required
                />
              )}
            </FormField>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label className="flex min-h-11 items-center gap-3">
              <Checkbox
                name="required"
                checked={required}
                onCheckedChange={(next) => setRequired(next === true)}
              />
              <span>Required when the form that shows it is saved</span>
            </Label>
            <p className="text-muted-foreground text-xs">
              Older records show “—” and save once filled. It never blocks a status change.
            </p>
          </div>

          <FormField label="Help text" error={error?.fieldErrors?.helpText}>
            {(control) => (
              <Input
                {...control}
                name="helpText"
                value={helpText}
                onChange={(event) => setHelpText(event.target.value)}
                maxLength={FIELD_HELP_MAX}
              />
            )}
          </FormField>

          <FormField
            label="Section"
            hint="Groups fields under a heading on the form."
            error={error?.fieldErrors?.section}
          >
            {(control) => (
              <Input
                {...control}
                name="section"
                value={section}
                onChange={(event) => setSection(event.target.value)}
                maxLength={FIELD_SECTION_MAX}
              />
            )}
          </FormField>

          <ActionStatus action={action} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              pending={pending}
              pendingLabel={editing ? "Saving field…" : "Adding field…"}
            >
              {editing ? "Save field" : "Add field"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
