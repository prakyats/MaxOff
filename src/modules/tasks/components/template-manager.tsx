"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  LayoutTemplateIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";

import type { FieldDefinition } from "@/core/custom-fields";
import { CustomFieldsForm } from "@/core/custom-fields/components/custom-fields-form";
import type { ResultError } from "@/core/errors";
import { cn } from "@/core/lib/utils";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/core/ui/primitives/sheet";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import { saveTemplate, setTemplateArchived } from "../actions/templates";
import { DESCRIPTION_MAX, STAGE_NAME_MAX, STAGES_MAX, TEMPLATE_NAME_MAX } from "../domain/limits";
import { templateActions, type TaskTemplate } from "../domain/templates";
import {
  type MemberRole,
  PRIORITIES,
  PRIORITY_LABELS,
  type Priority,
  type TaskType,
} from "../domain/types";

type Context = {
  viewer: { id: string; role: MemberRole };
  /** Every type, archived ones included: a template keeps an archived type (4B review S7). */
  types: readonly TaskType[];
  /** The task custom fields, company-wide and per type (their defaults). */
  definitions: readonly FieldDefinition[];
  /** Who a "member" field may name. */
  members: readonly { id: string; name: string }[];
  /** The authors' names, by id. */
  names: Readonly<Record<string, string>>;
};

/**
 * Settings → Templates (4.6; PRODUCT §4.6, WORKFLOWS §3.5, Kickoff 4 decision 19): task
 * templates, shared company-wide. Everyone with `templates.manage` (the Owner and Admins) adds one
 * and uses any in "New task → Start from"; an Admin edits and archives the ones they made, the
 * Owner any. A template holds a type, a priority, a description, stages and the task fields'
 * defaults; never a client, people or a deadline. Rows in the list-manager shape (1.4).
 */
export function TemplateManager({
  templates,
  ...context
}: Context & { templates: readonly TaskTemplate[] }) {
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [archiving, setArchiving] = useState<TaskTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = templates
    .filter((template) => !template.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const archived = templates
    .filter((template) => template.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const typeName = new Map(context.types.map((type) => [type.id, type.name]));

  function line(template: TaskTemplate): string {
    const stages =
      template.stages.length === 0
        ? null
        : template.stages.length === 1
          ? "1 stage"
          : `${template.stages.length} stages`;
    const author =
      template.createdBy === context.viewer.id
        ? "by you"
        : `by ${context.names[template.createdBy] ?? "someone"}`;
    return [
      typeName.get(template.taskTypeId) ?? "A task type",
      PRIORITY_LABELS[template.defaultPriority],
      stages,
      author,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function restore(template: TaskTemplate) {
    setBusyId(template.id);
    toastResult(await setTemplateArchived({ templateId: template.id, archived: false }), {
      success: "Template restored",
    });
    setBusyId(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {active.length === 0 ? (
        <EmptyState
          icon={LayoutTemplateIcon}
          title="No templates yet"
          description="Add one for work that repeats. New task offers it under Start from."
        />
      ) : (
        <ul
          data-slot="task-templates"
          className="border-border divide-border divide-y rounded-lg border"
        >
          {active.map((template) => {
            const allowed = templateActions(template, context.viewer);
            return (
              <li
                key={template.id}
                data-slot="task-template"
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                <div className={cn("flex min-w-0 flex-col gap-0.5", CARD_ROW_TITLE)}>
                  <span className="truncate text-sm font-medium">{template.name}</span>
                  <span className="text-muted-foreground text-xs break-words">
                    {line(template)}
                  </span>
                </div>
                {allowed.edit ? (
                  <div className={cn("flex items-center", CARD_ROW_TRAILING)}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${template.name}`}
                      onClick={() => setEditing(template)}
                      className="hidden md:inline-flex"
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      aria-label={`Archive ${template.name}`}
                      onClick={() => setArchiving(template)}
                      className="hidden md:inline-flex"
                    >
                      <ArchiveIcon aria-hidden />
                    </Button>
                    <RowSheet
                      name={template.name}
                      onEdit={() => setEditing(template)}
                      onArchive={() => setArchiving(template)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {archived.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-sm font-medium">Archived</h2>
          <p className="text-muted-foreground text-sm">
            Not offered in New task. Tasks made from one keep what it gave them.
          </p>
          <ul
            data-slot="archived-task-templates"
            className="border-border divide-border divide-y rounded-lg border"
          >
            {archived.map((template) => (
              <li
                key={template.id}
                data-slot="archived-task-template"
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                <span className={cn("text-muted-foreground truncate text-sm", CARD_ROW_TITLE)}>
                  {template.name}
                </span>
                {templateActions(template, context.viewer).restore ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={CARD_ROW_TRAILING}
                    disabled={busyId !== null}
                    onClick={() => void restore(template)}
                  >
                    <ArchiveRestoreIcon aria-hidden />
                    Restore
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editing ? (
        <TemplateDialog
          key={editing.id}
          template={editing}
          {...context}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {archiving ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setArchiving(null);
          }}
          title={`Archive ${archiving.name}?`}
          description="New task stops offering it. Tasks made from it keep what it gave them, and you can restore it later."
          confirmLabel={`Archive ${archiving.name}`}
          pendingLabel="Archiving…"
          onConfirm={async () =>
            toastResult(await setTemplateArchived({ templateId: archiving.id, archived: true }), {
              success: "Template archived",
            })
          }
        />
      ) : null}
    </div>
  );
}

/** Edit and Archive on a phone (1.5's shape). */
function RowSheet({
  name,
  onEdit,
  onArchive,
}: {
  name: string;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  function choose(then: () => void) {
    setOpen(false);
    then();
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${name}`}
          className="md:hidden"
        >
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        data-slot="task-template-actions"
        className="gap-3 rounded-t-2xl pb-[calc(1.5rem+var(--app-safe-bottom))]"
      >
        <div
          aria-hidden
          className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
        />
        <SheetHeader className="pt-3 pr-12 pb-0">
          <SheetTitle>{name}</SheetTitle>
          <SheetDescription className="sr-only">Template actions</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4">
          <Button
            variant="secondary"
            className="w-full justify-start"
            onClick={() => choose(onEdit)}
          >
            <PencilIcon aria-hidden />
            Edit
          </Button>
          <Button
            variant="destructive"
            className="w-full justify-start"
            onClick={() => choose(onArchive)}
          >
            <ArchiveIcon aria-hidden />
            Archive
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The screen's one primary action, for `PageHeader` (a FAB on a phone). */
export function AddTemplateButton(context: Context) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="strong" onClick={() => setOpen(true)} data-slot="add-template">
        <PlusIcon aria-hidden />
        Add template
      </Button>
      {open ? <TemplateDialog {...context} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Add or edit a template. The field defaults are the chosen type's task fields, none of them
 * required here (the task form asks for a required one when a task is made from it).
 */
function TemplateDialog({
  template,
  types,
  definitions,
  members,
  onClose,
}: Context & { template?: TaskTemplate; onClose: () => void }) {
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
  const [error, setError] = useState<ResultError | null>(null);
  const fields = definitions
    .filter((definition) => definition.taskTypeId === null || definition.taskTypeId === taskTypeId)
    .map((definition) => ({ ...definition, required: false }));
  const action = useAction(
    async () => {
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

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
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
                <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
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
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
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
  );
}
