"use client";

import { ExternalLinkIcon, PencilIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors/result";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { StickyActions } from "@/core/ui/composites/sticky-actions";
import { type ChangeSubject, describeChange, diffFields } from "@/core/ui/edit/changes";
import { claimEditor, releaseEditor, useActiveEditor } from "@/core/ui/edit/active-editor";
import { useEditRequest } from "@/core/ui/edit/edit-requests";
import { useLeaveGuard } from "@/core/ui/edit/use-leave-guard";
import { closeOverlaysThen, useOverlayHistory } from "@/core/ui/overlay/overlay-history";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError } from "@/core/ui/toast";

export interface EditableOption {
  value: string;
  label: string;
}

export interface EditableField<K extends string> {
  name: K;
  label: string;
  /** How the field reads in the confirmation: "Your **phone number** will change …". */
  noun: string;
  /** The saved value; `null` or "" shows `emptyLabel`. A select holds the option's `value`. */
  value: string | null;
  emptyLabel?: string;
  hint?: string;
  /**
   * The control (3.4): a one-line `Input` (typed through `input.type`: email, tel, url, date,
   * number…), a `textarea`, or a `select` of `options` (read mode and the confirmation show the
   * option's label, never its value).
   */
  kind?: "text" | "textarea" | "select";
  options?: readonly EditableOption[];
  /** A select that may be left empty offers this choice (value ""), e.g. "None". */
  noneLabel?: string;
  /** Lines a textarea opens with. */
  rows?: number;
  /**
   * How read mode shows the value: plain text (default), `multiline` (line breaks kept), a
   * `link` that opens in a new tab, or an `email` or `tel` link. (A brand's colours are a
   * structured `extra`, not a display of a string: `modules/clients` `BrandRecord`.)
   */
  display?: "text" | "multiline" | "link" | "email" | "tel";
  input?: Pick<
    ComponentProps<typeof Input>,
    "type" | "autoComplete" | "inputMode" | "maxLength" | "required" | "placeholder"
  >;
}

/**
 * A part of the record that is not a string field (3.4): a record's custom fields. It brings
 * its own controls and its own sentences for the confirmation; the record keeps one draft, one
 * Save and one "Discard changes?" for everything. `changes` names each difference as a full line
 * ("Sharma Weddings' Industry will change from A to B.") and returns none when nothing changed.
 */
export interface EditableExtra<V> {
  value: V;
  changes: (before: V, after: V) => string[];
  edit: (props: {
    value: V;
    onChange: (next: V) => void;
    errors: Record<string, string[]>;
  }) => ReactNode;
  read: (value: V) => ReactNode;
  /**
   * The server's field-error keys this part shows itself (under its own rows); any other key a
   * record does not show goes above the fields. Default: `customFields.*`.
   */
  owns?: (key: string) => boolean;
  /** Shown before the string fields instead of after them (a brand's colours and fonts). */
  first?: boolean;
}

type Mode = "read" | "edit" | "confirm" | "discard";

/**
 * The edit pattern (ARCHITECTURE §14.1, task 2.9): **read-only by default, explicit Edit,
 * explicit Save, confirm what changed, guard unsaved work.** Built once, copied everywhere a
 * record is edited (/me, a person's profile, a client, a contact, a brand).
 *
 * - **Read:** the values as plain text (a link, a phone where `display` says so) and
 *   a pencil **Edit**; with `canEdit` false, just the values.
 * - **Edit:** the fields (a typed input, a textarea or a select, 3.4) and any `extra` part (a
 *   record's custom fields), and Cancel and Save in a sticky bar; Save stays disabled until a
 *   value really differs from what was there when Edit was tapped (the baseline is taken then,
 *   so a refresh on return cannot move it).
 * - **Save** opens a confirmation that names each change ("Your name will change from X to
 *   Y"; a select by its label); confirming runs `onSave`. Success returns to read mode with
 *   "Saved"; field errors land under their fields, in edit mode.
 * - **Leaving with unsaved changes asks "Discard changes?"**: Cancel, the back gesture (edit mode
 *   is a history layer, §14.2 a and f), any in-app link, Log out and a reload (`useLeaveGuard`).
 *   Back with nothing changed simply leaves edit mode.
 * - **Edit from elsewhere** (a header ⋯ menu, 3.4): `requestEdit(editKey)`.
 *
 * Every way out of edit mode backs out the layer's history entry (`closeOverlaysThen`), so a save
 * or a cancel never leaves a back press that lands on the same page.
 */
export function EditableRecord<K extends string, V = undefined>({
  title,
  subject,
  fields,
  extra,
  onSave,
  confirmation,
  savedMessage,
  editLabel = "Edit",
  canEdit = true,
  editKey,
}: {
  title: string;
  subject: ChangeSubject;
  fields: readonly EditableField<K>[];
  /** Custom fields and the like (3.4), edited and saved with the fields. */
  extra?: EditableExtra<V>;
  onSave: (values: Record<K, string>, extra: V) => Promise<Result<unknown>>;
  /**
   * More for the save confirmation, from the draft: content under the named changes and whether
   * Save may run yet (a demoted Admin's clients still to hand over, phase 3 review). Null: none.
   */
  confirmation?: (values: Record<K, string>) => { content: ReactNode; ready: boolean } | null;
  savedMessage: string;
  editLabel?: string;
  /** False shows the record read-only with no Edit (a viewer who may not change it). */
  canEdit?: boolean;
  /** Lets a ⋯ menu start editing (`requestEdit(editKey)`, `core/ui/edit/edit-requests`). */
  editKey?: string;
}) {
  const formId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<Mode>("read");
  const [baseline, setBaseline] = useState<Record<K, string>>(() => valuesOf(fields));
  const [draft, setDraft] = useState<Record<K, string>>(() => valuesOf(fields));
  const [extraBaseline, setExtraBaseline] = useState<V | undefined>(() => extra?.value);
  const [extraDraft, setExtraDraft] = useState<V | undefined>(() => extra?.value);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Set while a way out of edit mode is backing out the history entry, so a dialog closing on
  // the way does not re-open edit mode.
  const leaving = useRef(false);
  // A navigation held by the leave guard, replayed once the changes are discarded.
  const pendingLeave = useRef<(() => void) | null>(null);

  const names = fields.map((field) => field.name);
  const editing = mode !== "read";
  const changes = diffFields(names, baseline, draft);
  const extraLines =
    extra && editing ? extra.changes(extraBaseline as V, extraDraft as V) : ([] as string[]);
  const changeCount = changes.length + extraLines.length;
  const dirty = editing && changeCount > 0;
  // Another record on the page is in edit mode: this one waits (3.4 review).
  const activeEditor = useActiveEditor();
  const blocked = activeEditor !== null && activeEditor !== formId;
  useEffect(() => {
    if (!editing) releaseEditor(formId);
  }, [editing, formId]);
  useEffect(() => () => releaseEditor(formId), [formId]);

  function clearMessages() {
    setFieldErrors({});
    setFormError(null);
  }

  function toRead(after?: () => void) {
    leaving.current = true;
    const done = () => {
      leaving.current = false;
      setMode("read");
      clearMessages();
      requestAnimationFrame(() => editButton.current?.focus());
      after?.();
    };
    if (!closeOverlaysThen(done)) done();
  }

  function askDiscard(resume: (() => void) | null) {
    pendingLeave.current = resume;
    setMode("discard");
  }

  // Back in edit mode: nothing changed → leave edit mode; changes → ask first.
  useOverlayHistory(mode === "edit", () => {
    if (leaving.current) return;
    if (dirty) {
      askDiscard(null);
    } else {
      setMode("read");
      clearMessages();
    }
  });
  useLeaveGuard(dirty, (resume) => askDiscard(resume));

  function startEdit() {
    if (!canEdit || mode !== "read" || !claimEditor(formId)) return;
    const current = valuesOf(fields);
    setBaseline(current);
    setDraft(current);
    setExtraBaseline(extra?.value);
    setExtraDraft(extra?.value);
    clearMessages();
    setMode("edit");
  }
  useEditRequest(canEdit ? editKey : undefined, startEdit);

  function cancel() {
    if (dirty) askDiscard(null);
    else toRead();
  }

  async function save(): Promise<boolean> {
    const result = await onSave(draft, extraDraft as V);
    if (result.ok) {
      toast.success(savedMessage);
      toRead();
      return true;
    }
    const { error } = result;
    const errors = error.fieldErrors ?? {};
    setFieldErrors(errors);
    const { title: errorTitle, description } = describeError(error);
    // A message for a field this record does not show (a required custom field on a record
    // without that part) must still be seen: it goes above the fields.
    const unshown = Object.keys(errors).find(
      (key) =>
        !names.includes(key as K) &&
        !(extra !== undefined && (extra.owns ?? isCustomFieldKey)(key)),
    );
    setFormError(
      unshown !== undefined
        ? (errors[unshown]?.[0] ?? description ?? errorTitle)
        : error.fieldErrors
          ? null
          : (description ?? errorTitle),
    );
    // Back to the fields, where the message is.
    setMode("edit");
    return true;
  }

  const fieldLines = [
    ...changes.map((change) => {
      const field = fields.find((candidate) => candidate.name === change.name);
      return describeChange(
        field
          ? { ...change, from: shown(field, change.from), to: shown(field, change.to) }
          : change,
        field?.noun ?? change.name,
        subject,
      );
    }),
  ];
  const lines = extra?.first ? [...extraLines, ...fieldLines] : [...fieldLines, ...extraLines];
  const more = mode === "confirm" && confirmation ? confirmation(draft) : null;
  const extraEditor =
    extra && editing
      ? extra.edit({ value: extraDraft as V, onChange: setExtraDraft, errors: fieldErrors })
      : null;

  return (
    <section data-slot="editable-record" aria-labelledby={`${formId}-title`}>
      {/* Wraps: at 200% system text "Profile" and "Edit profile" no longer share a phone's width. */}
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
        <h2 id={`${formId}-title`} className="text-sm font-medium">
          {title}
        </h2>
        {editing || !canEdit || blocked ? null : (
          <Button
            ref={editButton}
            type="button"
            variant="secondary"
            onClick={startEdit}
            data-slot="edit-record"
          >
            <PencilIcon aria-hidden />
            {editLabel}
          </Button>
        )}
      </div>

      {editing ? (
        <form
          noValidate
          className="mt-3 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (changeCount > 0) setMode("confirm");
          }}
        >
          {formError ? <ErrorText slot="form-alert">{formError}</ErrorText> : null}
          {extra?.first ? extraEditor : null}
          {fields.map((field, index) => (
            <FormField
              key={field.name}
              label={field.label}
              hint={field.hint}
              error={fieldErrors[field.name]}
            >
              {(control) => (
                <FieldControl
                  field={field}
                  control={control}
                  value={draft[field.name]}
                  autoFocus={index === 0 && !extra?.first}
                  onChange={(next) => setDraft({ ...draft, [field.name]: next })}
                />
              )}
            </FormField>
          ))}
          {extra?.first ? null : extraEditor}
          {/* Only while editing, so it never hangs over the rest of the page (§14.1). */}
          <StickyActions>
            <Button type="button" variant="secondary" onClick={cancel}>
              Cancel
            </Button>
            {/* pending: none (it opens the confirmation; the confirmation's Save commits) */}
            <Button
              variant="primary"
              type="submit"
              disabled={changeCount === 0}
              data-slot="save-record"
            >
              Save
            </Button>
          </StickyActions>
        </form>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {extra?.first ? extra.read(extra.value) : null}
          <dl className="flex flex-col gap-3 text-sm">
            {fields.map((field) => (
              <div key={field.name} data-slot="record-value">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="font-medium break-words">
                  <ReadValue field={field} />
                </dd>
              </div>
            ))}
          </dl>
          {extra && !extra.first ? extra.read(extra.value) : null}
        </div>
      )}

      <ConfirmDialog
        open={mode === "confirm"}
        onOpenChange={(open) => {
          if (!open && !leaving.current && mode === "confirm") setMode("edit");
        }}
        title="Save these changes?"
        confirmLabel="Save"
        cancelLabel="Keep editing"
        onConfirm={save}
        confirmDisabled={more ? !more.ready : false}
      >
        <ChangeList lines={lines} />
        {more?.content}
      </ConfirmDialog>

      <ConfirmDialog
        open={mode === "discard"}
        onOpenChange={(open) => {
          if (!open && !leaving.current && mode === "discard") {
            pendingLeave.current = null;
            setMode("edit");
          }
        }}
        title="Discard changes?"
        description="What you changed here has not been saved."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          const resume = pendingLeave.current;
          pendingLeave.current = null;
          toRead(resume ?? undefined);
          return true;
        }}
      />
    </section>
  );
}

/** The named changes inside a save confirmation. Shared with dialogs that edit a record. */
export function ChangeList({ lines }: { lines: readonly string[] }) {
  return (
    <ul data-slot="change-list" className="flex list-disc flex-col gap-1 pl-5 text-sm">
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}

/** What a value reads as: a select's option label, anything else as it is. */
export function shownValue(
  field: Pick<EditableField<string>, "kind" | "options">,
  value: string,
): string {
  if (field.kind !== "select" || value === "") return value;
  return field.options?.find((option) => option.value === value)?.label ?? value;
}

function shown<K extends string>(field: EditableField<K>, value: string): string {
  return shownValue(field, value);
}

const NONE = "__none__";

function isCustomFieldKey(key: string): boolean {
  return key.startsWith("customFields.");
}

function FieldControl<K extends string>({
  field,
  control,
  value,
  autoFocus,
  onChange,
}: {
  field: EditableField<K>;
  control: { id: string; "aria-invalid": true | undefined; "aria-describedby": string | undefined };
  value: string;
  autoFocus: boolean;
  onChange: (next: string) => void;
}) {
  if (field.kind === "select") {
    return (
      <Select
        value={value === "" ? NONE : value}
        onValueChange={(next) => onChange(next === NONE ? "" : next)}
      >
        <SelectTrigger
          id={control.id}
          className="w-full"
          aria-describedby={control["aria-describedby"]}
          aria-invalid={control["aria-invalid"]}
          name={field.name}
          autoFocus={autoFocus}
        >
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {field.noneLabel !== undefined ? (
            <SelectItem value={NONE}>{field.noneLabel}</SelectItem>
          ) : null}
          {(field.options ?? []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (field.kind === "textarea") {
    return (
      <Textarea
        {...control}
        name={field.name}
        value={value}
        rows={field.rows ?? 3}
        maxLength={field.input?.maxLength}
        placeholder={field.input?.placeholder}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <Input
      {...control}
      {...field.input}
      name={field.name}
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function ReadValue<K extends string>({ field }: { field: EditableField<K> }) {
  const text = field.value ? shown(field, field.value) : "";
  if (!text.trim()) {
    return (
      <span className="text-muted-foreground font-normal">{field.emptyLabel ?? "Not added"}</span>
    );
  }
  switch (field.display) {
    case "multiline":
      return <span className="whitespace-pre-line">{text}</span>;
    case "link":
      return (
        <a
          href={text}
          target="_blank"
          rel="noreferrer"
          data-slot="record-link"
          aria-label={`${text} (opens in a new tab)`}
          className="pressable-row inline-flex min-h-11 max-w-full items-center gap-1 underline underline-offset-4"
        >
          {/* A flex item keeps its text's width unless told otherwise: a long URL would overflow. */}
          <span className="min-w-0 break-all">{text}</span>
          <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
        </a>
      );
    case "email":
      return (
        <a
          href={`mailto:${text}`}
          className="pressable-row inline-flex min-h-11 max-w-full min-w-11 items-center underline underline-offset-4"
        >
          <span className="min-w-0 break-all">{text}</span>
        </a>
      );
    case "tel":
      return (
        <a
          href={`tel:${text.replace(/\s+/g, "")}`}
          className="pressable-row inline-flex min-h-11 min-w-11 items-center underline underline-offset-4"
        >
          {text}
        </a>
      );
    default:
      return <>{text}</>;
  }
}

function valuesOf<K extends string>(fields: readonly EditableField<K>[]): Record<K, string> {
  return Object.fromEntries(fields.map((field) => [field.name, field.value ?? ""])) as Record<
    K,
    string
  >;
}
