"use client";

import { PencilIcon } from "lucide-react";
import { type ComponentProps, useId, useRef, useState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors/result";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { FormField } from "@/core/ui/composites/form-field";
import { StickyActions } from "@/core/ui/composites/sticky-actions";
import { type ChangeSubject, describeChange, diffFields } from "@/core/ui/edit/changes";
import { useLeaveGuard } from "@/core/ui/edit/use-leave-guard";
import { closeOverlaysThen, useOverlayHistory } from "@/core/ui/overlay/overlay-history";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import { describeError } from "@/core/ui/toast";

export interface EditableField<K extends string> {
  name: K;
  label: string;
  /** How the field reads in the confirmation: "Your **phone number** will change …". */
  noun: string;
  /** The saved value; `null` or "" shows `emptyLabel`. */
  value: string | null;
  emptyLabel?: string;
  hint?: string;
  input?: Pick<
    ComponentProps<typeof Input>,
    "type" | "autoComplete" | "inputMode" | "maxLength" | "required"
  >;
}

type Mode = "read" | "edit" | "confirm" | "discard";

/**
 * The edit pattern (ARCHITECTURE §14.1, task 2.9): **read-only by default, explicit Edit,
 * explicit Save, confirm what changed, guard unsaved work.** Built once, copied everywhere a
 * record is edited (3.4's client screens are the next).
 *
 * - **Read:** the values as plain text and a pencil **Edit**.
 * - **Edit:** the fields, and Cancel and Save in a sticky bar; Save stays disabled until a value
 *   really differs from what was there when Edit was tapped (the baseline is taken then, so a
 *   refresh on return cannot move it).
 * - **Save** opens a confirmation that names each change ("Your name will change from X to
 *   Y"); confirming runs `onSave`. Success returns to read mode with "Saved"; field errors land
 *   under their fields, in edit mode.
 * - **Leaving with unsaved changes asks "Discard changes?"**: Cancel, the back gesture (edit mode
 *   is a history layer, §14.2 a and f), any in-app link, Log out and a reload (`useLeaveGuard`).
 *   Back with nothing changed simply leaves edit mode.
 *
 * Every way out of edit mode backs out the layer's history entry (`closeOverlaysThen`), so a save
 * or a cancel never leaves a back press that lands on the same page.
 */
export function EditableRecord<K extends string>({
  title,
  subject,
  fields,
  onSave,
  savedMessage,
  editLabel = "Edit",
}: {
  title: string;
  subject: ChangeSubject;
  fields: readonly EditableField<K>[];
  onSave: (values: Record<K, string>) => Promise<Result<unknown>>;
  savedMessage: string;
  editLabel?: string;
}) {
  const formId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<Mode>("read");
  const [baseline, setBaseline] = useState<Record<K, string>>(() => valuesOf(fields));
  const [draft, setDraft] = useState<Record<K, string>>(() => valuesOf(fields));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Set while a way out of edit mode is backing out the history entry, so a dialog closing on
  // the way does not re-open edit mode.
  const leaving = useRef(false);
  // A navigation held by the leave guard, replayed once the changes are discarded.
  const pendingLeave = useRef<(() => void) | null>(null);

  const names = fields.map((field) => field.name);
  const changes = diffFields(names, baseline, draft);
  const editing = mode !== "read";
  const dirty = editing && changes.length > 0;

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
    const current = valuesOf(fields);
    setBaseline(current);
    setDraft(current);
    clearMessages();
    setMode("edit");
  }

  function cancel() {
    if (dirty) askDiscard(null);
    else toRead();
  }

  async function save(): Promise<boolean> {
    const result = await onSave(draft);
    if (result.ok) {
      toast.success(savedMessage);
      toRead();
      return true;
    }
    const { error } = result;
    setFieldErrors(error.fieldErrors ?? {});
    const { title: errorTitle, description } = describeError(error);
    setFormError(error.fieldErrors ? null : (description ?? errorTitle));
    // Back to the fields, where the message is.
    setMode("edit");
    return true;
  }

  return (
    <section data-slot="editable-record" aria-labelledby={`${formId}-title`}>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id={`${formId}-title`} className="text-sm font-medium">
          {title}
        </h2>
        {editing ? null : (
          <Button
            ref={editButton}
            type="button"
            variant="outline"
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
            if (changes.length > 0) setMode("confirm");
          }}
        >
          {formError ? (
            <p role="alert" data-slot="form-alert" className="text-destructive text-sm">
              {formError}
            </p>
          ) : null}
          {fields.map((field, index) => (
            <FormField
              key={field.name}
              label={field.label}
              hint={field.hint}
              error={fieldErrors[field.name]}
            >
              {(control) => (
                <Input
                  {...control}
                  {...field.input}
                  name={field.name}
                  value={draft[field.name]}
                  autoFocus={index === 0}
                  onChange={(event) => setDraft({ ...draft, [field.name]: event.target.value })}
                />
              )}
            </FormField>
          ))}
          {/* Only while editing, so it never hangs over the rest of the page (§14.1). */}
          <StickyActions>
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={changes.length === 0} data-slot="save-record">
              Save
            </Button>
          </StickyActions>
        </form>
      ) : (
        <dl className="mt-3 flex flex-col gap-3 text-sm">
          {fields.map((field) => (
            <div key={field.name} data-slot="record-value">
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="font-medium break-words">
                {field.value ? (
                  field.value
                ) : (
                  <span className="text-muted-foreground font-normal">
                    {field.emptyLabel ?? "Not added"}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
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
      >
        <ChangeList
          lines={changes.map((change) =>
            describeChange(
              change,
              fields.find((field) => field.name === change.name)?.noun ?? change.name,
              subject,
            ),
          )}
        />
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
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
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
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function valuesOf<K extends string>(fields: readonly EditableField<K>[]): Record<K, string> {
  return Object.fromEntries(fields.map((field) => [field.name, field.value ?? ""])) as Record<
    K,
    string
  >;
}
