"use client";

import { useState } from "react";

import {
  CustomFieldsForm,
  type CustomFieldValues,
} from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
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

import { createProjectTemplate, updateProjectTemplate } from "../actions/project-templates";
import {
  linesOf,
  type ProjectTemplate,
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_ITEMS_MAX,
  TEMPLATE_NAME_MAX,
  TEMPLATE_STAGES_MAX,
  type TemplateRecurrence,
} from "../domain/project-templates";

const RECURRENCE_LABELS: Record<TemplateRecurrence, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  one_time: "One-time",
};
const NONE = "__none__";

export type ProjectTemplateContext = {
  viewer: { id: string; role: string };
  names: Readonly<Record<string, string>>;
  presets: readonly { id: string; name: string; stages: string[] }[];
  definitions: readonly FieldDefinition[];
};

/**
 * Add or edit a project template (loaded when it first opens: ARCHITECTURE §19; mounted while
 * open). A layer (§14.2 a): back closes it, and asks "Discard?" first when something changed
 * (§14.2 f); back on that keeps editing.
 */
export function ProjectTemplateDialog({
  template,
  presets,
  definitions,
  onClose,
}: ProjectTemplateContext & { template?: ProjectTemplate; onClose: () => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [recurrence, setRecurrence] = useState<TemplateRecurrence>(
    template?.recurrence ?? "monthly",
  );
  const [stages, setStages] = useState(template?.stages.join("\n") ?? "");
  const [items, setItems] = useState(template?.items.join("\n") ?? "");
  const [fields, setFields] = useState<CustomFieldValues>(template?.fieldDefaults ?? {});
  const [errors, setErrors] = useState<Readonly<Record<string, string[]>>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"form" | "discard">("form");
  const [initial] = useState(() =>
    JSON.stringify([name, description, recurrence, stages, items, fields]),
  );
  const dirty = JSON.stringify([name, description, recurrence, stages, items, fields]) !== initial;
  const editing = template !== undefined;

  function requestClose() {
    if (pending) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const values = {
      name,
      ...(description.trim() ? { description } : {}),
      recurrence,
      stages: linesOf(stages),
      items: linesOf(items),
      fieldDefaults: fields,
    };
    const result = template
      ? await updateProjectTemplate({ templateId: template.id, ...values })
      : await createProjectTemplate(values);
    setPending(false);
    if (!result.ok) {
      setErrors(result.error.fieldErrors ?? {});
      const { title, description: detail } = describeError(result.error);
      setSummary(result.error.fieldErrors ? null : (detail ?? title));
      return;
    }
    toastResult(result, { success: template ? "Template saved" : "Template added" });
    onClose();
  }

  return (
    <>
      <Dialog
        open={phase === "form"}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent data-slot="project-template-dialog">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {template ? `Edit ${template.name}` : "Add a project template"}
              </DialogTitle>
              <DialogDescription>
                New project copies it; every project made from it stays editable.
              </DialogDescription>
            </DialogHeader>
            {summary ? <ErrorText slot="form-alert">{summary}</ErrorText> : null}
            <FormField label="Name" error={errors.name}>
              {(control) => (
                <Input
                  {...control}
                  value={name}
                  maxLength={TEMPLATE_NAME_MAX}
                  onChange={(event) => setName(event.target.value)}
                  required
                  autoFocus
                />
              )}
            </FormField>
            <FormField label="Repeats" error={errors.recurrence}>
              {(control) => (
                <Select
                  value={recurrence}
                  onValueChange={(value) => setRecurrence(value as TemplateRecurrence)}
                >
                  <SelectTrigger id={control.id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RECURRENCE_LABELS) as TemplateRecurrence[]).map((value) => (
                      <SelectItem key={value} value={value}>
                        {RECURRENCE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField
              label="Stages"
              hint={`One per line, at most ${TEMPLATE_STAGES_MAX}.`}
              error={errors.stages}
            >
              {(control) => (
                <div className="flex flex-col gap-2">
                  {presets.length > 0 ? (
                    <Select
                      value={NONE}
                      onValueChange={(id) => {
                        const preset = presets.find((option) => option.id === id);
                        if (preset) setStages(preset.stages.join("\n"));
                      }}
                    >
                      <SelectTrigger className="w-full" aria-label="Fill from a stage preset">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Fill from a preset…</SelectItem>
                        {presets.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            {preset.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <Textarea
                    {...control}
                    rows={3}
                    value={stages}
                    onChange={(event) => setStages(event.target.value)}
                  />
                </div>
              )}
            </FormField>
            <FormField
              label="Item list"
              hint={`One per line, at most ${TEMPLATE_ITEMS_MAX}.`}
              error={errors.items}
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={4}
                  value={items}
                  onChange={(event) => setItems(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Description" error={errors.description}>
              {(control) => (
                <Textarea
                  {...control}
                  rows={2}
                  maxLength={TEMPLATE_DESCRIPTION_MAX}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </FormField>
            {definitions.length > 0 ? (
              <CustomFieldsForm
                definitions={definitions}
                values={fields}
                onChange={setFields}
                errors={errors}
                disabled={pending}
              />
            ) : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" pending={pending} pendingLabel="Saving…">
                {template ? "Save template" : "Add template"}
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
