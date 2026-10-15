"use client";

import { useState } from "react";

import {
  CustomFieldsForm,
  type CustomFieldValues,
} from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import {
  type Deliverable,
  type StageGroup,
  deliverablesIssue,
  stageGroupsIssue,
} from "@/core/lib/stage-groups";
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
import { DeliverablesEditor } from "@/core/ui/stage-groups/deliverables-editor";
import { DeliverablesPreview } from "@/core/ui/stage-groups/deliverables-preview";
import { StageGroupsEditor } from "@/core/ui/stage-groups/stage-groups-editor";
import { describeError, toastResult } from "@/core/ui/toast";
import { useIsDesktop } from "@/core/ui/viewport/use-desktop";

import { createProjectTemplate, updateProjectTemplate } from "../actions/project-templates";
import {
  type ProjectTemplate,
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_ITEMS_MAX,
  TEMPLATE_NAME_MAX,
  type TemplateRecurrence,
} from "../domain/project-templates";

const RECURRENCE_LABELS: Record<TemplateRecurrence, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  one_time: "One-time",
};

export type ProjectTemplateContext = {
  viewer: { id: string; role: string };
  names: Readonly<Record<string, string>>;
  presets: readonly { id: string; name: string; stages: string[] }[];
  definitions: readonly FieldDefinition[];
};

type Errors = Readonly<Record<string, string[]>>;

/** A field's messages, including nested ones the server names by path ("deliverables.0.title"). */
function messagesFor(errors: Errors, field: string): string[] {
  return Object.entries(errors)
    .filter(([key]) => key === field || key.startsWith(`${field}.`))
    .flatMap(([, messages]) => messages);
}

/**
 * Add or edit a project template (loaded when it first opens: ARCHITECTURE §19; mounted while
 * open), the 6b builder (ROADMAP 6b.13, 6b.16 (a)(b), 6b.18; DATA-MODEL §5b): name, repeat,
 * **Default stage groups**, **Deliverables** (each with its own groups) and a **live preview** of
 * what a project made from it gets: beside the form on a laptop, a Preview layer before Save on a
 * phone. Nothing is saved until Save. A template from before groups opens with its stages on each
 * item as one untitled group. A layer (§14.2 a): back closes the top one (the preview, then the
 * form), and asks "Discard?" first when something changed (§14.2 f); back on that keeps editing.
 */
export function ProjectTemplateDialog({
  template,
  presets,
  definitions,
  onClose,
}: ProjectTemplateContext & { template?: ProjectTemplate; onClose: () => void }) {
  const desktop = useIsDesktop();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [recurrence, setRecurrence] = useState<TemplateRecurrence>(
    template?.recurrence ?? "monthly",
  );
  const [stageGroups, setStageGroups] = useState<StageGroup[]>(template?.stageGroups ?? []);
  const [deliverables, setDeliverables] = useState<Deliverable[]>(template?.deliverables ?? []);
  const [fields, setFields] = useState<CustomFieldValues>(template?.fieldDefaults ?? {});
  const [errors, setErrors] = useState<Errors>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"form" | "preview" | "discard">("form");
  const snapshot = () =>
    JSON.stringify([name, description, recurrence, stageGroups, deliverables, fields]);
  const [initial] = useState(snapshot);
  const dirty = snapshot() !== initial;
  const editing = template !== undefined;
  const commitLabel = editing ? "Save template" : "Add template";

  function requestClose() {
    if (pending) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  /** The form's own check before Preview or Save, in the database's words. */
  function check(): boolean {
    const found: Record<string, string[]> = {};
    if (name.trim() === "") found.name = ["Name the template."];
    const groupsProblem = stageGroupsIssue(stageGroups);
    if (groupsProblem) found.stageGroups = [groupsProblem];
    const deliverablesProblem =
      deliverables.length > TEMPLATE_ITEMS_MAX
        ? `At most ${TEMPLATE_ITEMS_MAX} deliverables.`
        : deliverablesIssue(deliverables);
    if (deliverablesProblem) found.deliverables = [deliverablesProblem];
    setErrors(found);
    const first = Object.values(found)[0]?.[0];
    setSummary(first ?? null);
    return first === undefined;
  }

  async function save() {
    setPending(true);
    const values = {
      name,
      ...(description.trim() ? { description } : {}),
      recurrence,
      stageGroups,
      deliverables,
      fieldDefaults: fields,
    };
    const result = template
      ? await updateProjectTemplate({ templateId: template.id, ...values })
      : await createProjectTemplate(values);
    setPending(false);
    if (!result.ok) {
      const fieldErrors = result.error.fieldErrors ?? {};
      setErrors(fieldErrors);
      const { title, description: detail } = describeError(result.error);
      setSummary(
        result.error.fieldErrors ? (Object.values(fieldErrors)[0]?.[0] ?? null) : (detail ?? title),
      );
      setPhase("form");
      return;
    }
    toastResult(result, { success: template ? "Template saved" : "Template added" });
    onClose();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check()) return;
    // A phone sees what it will save first (6b.16 (a)); a laptop has the preview beside the form.
    if (desktop === false) setPhase("preview");
    else void save();
  }

  const stageGroupErrors = messagesFor(errors, "stageGroups");
  const deliverableErrors = messagesFor(errors, "deliverables");

  return (
    <>
      <Dialog
        open={phase !== "discard"}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent data-slot="project-template-dialog" className="md:max-w-5xl">
          <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {template ? `Edit ${template.name}` : "Add a project template"}
              </DialogTitle>
              <DialogDescription>
                New project copies it; every project made from it stays editable.
              </DialogDescription>
            </DialogHeader>
            {summary ? <ErrorText slot="form-alert">{summary}</ErrorText> : null}
            <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
              <div className="flex min-w-0 flex-col gap-4">
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
                <section
                  aria-labelledby="template-default-groups"
                  data-slot="template-default-groups"
                  className="flex min-w-0 flex-col gap-2"
                >
                  <h3 id="template-default-groups" className="text-sm font-medium">
                    Default stage groups
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    Optional. A deliverable without its own stages uses these.
                  </p>
                  <StageGroupsEditor
                    value={stageGroups}
                    onChange={setStageGroups}
                    presets={presets}
                    label="Default stage groups"
                    disabled={pending}
                  />
                  {stageGroupErrors.length > 0 && !stageGroupsIssue(stageGroups) ? (
                    <ErrorText>{stageGroupErrors[0]}</ErrorText>
                  ) : null}
                </section>
                <section
                  aria-labelledby="template-deliverables"
                  data-slot="template-deliverables"
                  className="flex min-w-0 flex-col gap-2"
                >
                  <h3 id="template-deliverables" className="text-sm font-medium">
                    Deliverables
                  </h3>
                  <DeliverablesEditor
                    value={deliverables}
                    onChange={setDeliverables}
                    presets={presets}
                    defaults={stageGroups}
                    maxDeliverables={TEMPLATE_ITEMS_MAX}
                    disabled={pending}
                  />
                  {deliverableErrors.length > 0 && !deliverablesIssue(deliverables) ? (
                    <ErrorText>{deliverableErrors[0]}</ErrorText>
                  ) : null}
                </section>
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
              </div>
              {/* A laptop's preview, beside the form and following it as it scrolls. */}
              <aside className="hidden min-w-0 md:block" data-slot="template-preview-panel">
                <div
                  data-slot="template-preview-scroller"
                  className="border-border sticky top-0 flex max-h-[calc(100dvh-12rem)] flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg border px-3 pb-3"
                >
                  <h3 className="pt-3 text-sm font-medium">Preview</h3>
                  <DeliverablesPreview deliverables={deliverables} defaults={stageGroups} />
                </div>
              </aside>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                Cancel
              </Button>
              {desktop === false ? (
                // pending: none — it opens the Preview layer, whose own button saves.
                <Button type="submit" variant="strong" data-slot="template-preview">
                  Preview
                </Button>
              ) : (
                <Button type="submit" variant="primary" pending={pending} pendingLabel="Saving…">
                  {commitLabel}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* A phone's Preview step: its own layer, so back returns to the form (§14.2 a). */}
      <Dialog
        open={phase === "preview"}
        onOpenChange={(open) => {
          if (!open && !pending) setPhase("form");
        }}
      >
        <DialogContent data-slot="project-template-preview">
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
            <DialogDescription>
              What a project made from {name.trim() || "this template"} starts with.
            </DialogDescription>
          </DialogHeader>
          <DeliverablesPreview deliverables={deliverables} defaults={stageGroups} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setPhase("form")}
            >
              Back to editing
            </Button>
            <Button
              type="button"
              variant="primary"
              pending={pending}
              pendingLabel="Saving…"
              onClick={() => void save()}
            >
              {commitLabel}
            </Button>
          </DialogFooter>
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
