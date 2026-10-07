"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import type { FieldDefinition } from "@/core/custom-fields";
import { CustomFieldsForm } from "@/core/custom-fields/components/custom-fields-form";
import type { ResultError } from "@/core/errors";
import {
  draftFromRules,
  type ReminderDraft,
  type ReminderRule,
  rulesFromDraft,
} from "@/core/lib/reminder-rules";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { ReminderRulesEditor } from "@/core/ui/composites/reminder-rules-editor";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Input } from "@/core/ui/primitives/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import { saveTemplate } from "../actions/templates";
import { DESCRIPTION_MAX, STAGE_NAME_MAX, STAGES_MAX, TEMPLATE_NAME_MAX } from "../domain/limits";
import { templateDefaultReminders } from "../domain/reminders";
import type { TaskTemplate } from "../domain/templates";
import {
  type MemberRole,
  PRIORITIES,
  PRIORITY_LABELS,
  type Priority,
  type TaskType,
} from "../domain/types";

export type TemplateContext = {
  viewer: { id: string; role: MemberRole };
  /** Every type, archived ones included: a template keeps an archived type (4B review S7). */
  types: readonly TaskType[];
  /** The task custom fields, company-wide and per type (their defaults). */
  definitions: readonly FieldDefinition[];
  /** Who a "member" field may name. */
  members: readonly { id: string; name: string }[];
  /** The authors' names, by id. */
  names: Readonly<Record<string, string>>;
  /** The organisation's default reminders (5.3), under the type's: a template's "default". */
  orgReminders: readonly ReminderRule[];
};

/**
 * Add or edit a template. The field defaults are the chosen type's task fields, none of them
 * required here (the task form asks for a required one when a task is made from it). A layer
 * (§14.2 a): back closes it, and asks "Discard?" first when something changed (§14.2 f); the
 * draft lives here, outside the `Dialog`, so "Keep editing" brings it back.
 */
export function TemplateDialog({
  template,
  types,
  definitions,
  members,
  orgReminders,
  onClose,
}: TemplateContext & { template?: TaskTemplate; onClose: () => void }) {
  const editing = template !== undefined;
  const offered = types.filter((type) => !type.archived || type.id === template?.taskTypeId);
  const [name, setName] = useState(template?.name ?? "");
  const [taskTypeId, setTaskTypeId] = useState(template?.taskTypeId ?? offered[0]?.id ?? "");
  const [priority, setPriority] = useState<Priority>(template?.defaultPriority ?? "medium");
  const [description, setDescription] = useState(template?.description ?? "");
  const [stages, setStages] = useState<string[]>(template?.stages ?? []);
  const [fieldDefaults, setFieldDefaults] = useState<Record<string, unknown>>(
    template?.fieldDefaults ?? {},
  );
  const [reminders, setReminders] = useState<ReminderDraft>(() =>
    draftFromRules(template?.reminderRules ?? []),
  );
  const [initial] = useState(() =>
    JSON.stringify([name, taskTypeId, priority, description, stages, fieldDefaults, reminders]),
  );
  const [remindersBlocked, setRemindersBlocked] = useState(false);
  const [phase, setPhase] = useState<"form" | "discard">("form");
  const [error, setError] = useState<ResultError | null>(null);
  const fields = definitions
    .filter((definition) => definition.taskTypeId === null || definition.taskTypeId === taskTypeId)
    .map((definition) => ({ ...definition, required: false }));
  const reminderRules = rulesFromDraft(reminders);
  const action = useAction(
    async () => {
      if (reminderRules === null) {
        setRemindersBlocked(true);
        return;
      }
      const keys = new Set(fields.map((definition) => definition.key));
      const result = await saveTemplate({
        templateId: template?.id ?? null,
        template: {
          name,
          taskTypeId,
          description: description.trim() ? description : null,
          defaultPriority: priority,
          stages: stages.map((stage) => stage.trim()).filter(Boolean),
          fieldDefaults: Object.fromEntries(
            Object.entries(fieldDefaults).filter(([key]) => keys.has(key)),
          ),
          reminderRules,
        },
      });
      if (result.ok) {
        toastResult(result, { success: editing ? "Template saved" : "Template added" });
        onClose();
      } else {
        setError(result.error);
      }
    },
    { creates: !editing },
  );
  const { pending } = action;
  const dirty =
    JSON.stringify([name, taskTypeId, priority, description, stages, fieldDefaults, reminders]) !==
    initial;
  const remindersError =
    Object.entries(error?.fieldErrors ?? {}).find(([key]) =>
      key.startsWith("template.reminderRules"),
    )?.[1]?.[0] ??
    (remindersBlocked && reminderRules === null
      ? "Fix the reminders, or use the default."
      : undefined);
  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  const customErrors = Object.fromEntries(
    Object.entries(fieldErrors)
      .filter(
        ([key]) => key.startsWith("template.fieldDefaults.") || key.startsWith("customFields."),
      )
      .map(([key, messages]) => [
        `customFields.${key.replace(/^template\.fieldDefaults\.|^customFields\./, "")}`,
        messages,
      ]),
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    action.run();
  }

  function requestClose() {
    if (pending) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  return (
    <>
      <Dialog
        open={phase === "form"}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent className="md:max-w-xl">
          <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editing ? `Edit ${template.name}` : "Add a template"}</DialogTitle>
              <DialogDescription>
                New task offers it under Start from. It never fixes the people, the deadline or the
                client.
              </DialogDescription>
            </DialogHeader>
            {summary ? (
              <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
            ) : null}
            <FormField label="Name" error={fieldErrors["template.name"]}>
              {(control) => (
                <Input
                  {...control}
                  value={name}
                  maxLength={TEMPLATE_NAME_MAX}
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              )}
            </FormField>
            <div className="flex flex-col gap-4 sm:flex-row">
              <FormField
                label="Type"
                error={fieldErrors["template.taskTypeId"]}
                className="min-w-0 flex-1"
              >
                {(control) => (
                  <Select value={taskTypeId} onValueChange={setTaskTypeId}>
                    <SelectTrigger
                      id={control.id}
                      className="w-full"
                      aria-describedby={control["aria-describedby"]}
                      aria-invalid={control["aria-invalid"]}
                    >
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {offered.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label="Priority" className="min-w-0 flex-1">
                {(control) => (
                  <Select
                    value={priority}
                    onValueChange={(value) => setPriority(value as Priority)}
                  >
                    <SelectTrigger
                      id={control.id}
                      className="w-full"
                      aria-describedby={control["aria-describedby"]}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {PRIORITY_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>
            <FormField
              label="Description"
              hint="Optional. Filled in when the task has none of its own."
              error={fieldErrors["template.description"]}
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={DESCRIPTION_MAX}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </FormField>
            <ReminderRulesEditor
              draft={reminders}
              onChange={(next) => {
                setReminders(next);
                setRemindersBlocked(false);
              }}
              fallback={templateDefaultReminders({
                type: types.find((type) => type.id === taskTypeId)?.defaultReminders ?? null,
                organisation: orgReminders,
              })}
              disabled={pending}
              error={remindersError}
            />
            <fieldset className="flex min-w-0 flex-col gap-2" data-slot="template-stages">
              <legend className="mb-1.5 text-sm font-medium">
                Stages <span className="text-muted-foreground font-normal">(optional)</span>
              </legend>
              {stages.map((stage, index) => (
                <div key={index} className="flex items-center gap-1">
                  <Input
                    aria-label={`Stage ${index + 1}`}
                    value={stage}
                    maxLength={STAGE_NAME_MAX}
                    autoComplete="off"
                    onChange={(event) => {
                      const value = event.target.value;
                      setStages((current) => current.map((s, at) => (at === index ? value : s)));
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={`Remove stage ${index + 1}`}
                    onClick={() => setStages((current) => current.filter((_, at) => at !== index))}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </div>
              ))}
              {fieldErrors["template.stages"] ? (
                <ErrorText slot="field-error">{fieldErrors["template.stages"]}</ErrorText>
              ) : null}
              {stages.length < STAGES_MAX ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 self-start"
                  onClick={() => setStages((current) => [...current, ""])}
                >
                  <PlusIcon aria-hidden />
                  Add stage
                </Button>
              ) : null}
            </fieldset>
            {fields.length > 0 ? (
              <div className="flex flex-col gap-2" data-slot="template-field-defaults">
                <p className="text-sm font-medium">Field defaults</p>
                <CustomFieldsForm
                  definitions={fields}
                  values={fieldDefaults}
                  onChange={setFieldDefaults}
                  errors={customErrors}
                  members={members}
                  disabled={pending}
                />
              </div>
            ) : null}
            <ActionStatus action={action} />
            <DialogFooter className="sticky bottom-[calc(-1rem-var(--app-safe-bottom))] z-10 md:static">
              <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                pending={pending}
                pendingLabel={editing ? "Saving…" : "Adding…"}
              >
                {editing ? "Save template" : "Add template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={phase === "discard"}
        onOpenChange={(open) => {
          if (!open) setPhase("form");
        }}
        title={editing ? "Discard your changes?" : "Discard this template?"}
        description={
          editing ? "The template stays as it was." : "What you typed has not been saved."
        }
        confirmLabel={editing ? "Discard changes" : "Discard template"}
        cancelLabel="Keep editing"
        onConfirm={() => {
          onClose();
        }}
      />
    </>
  );
}
