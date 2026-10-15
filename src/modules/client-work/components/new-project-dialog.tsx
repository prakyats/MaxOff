"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  CustomFieldsForm,
  type CustomFieldValues,
} from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import type { ResultError } from "@/core/errors";
import { type Deliverable, groupsFromNames, type StageGroup } from "@/core/lib/stage-groups";
import { ActionStatus } from "@/core/ui/action/action-status";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { NAV_FORWARD } from "@/core/ui/motion/nav-types";
import { nameSlide } from "@/core/ui/motion/slide";
import { closeOverlaysThen, useOverlayHistory } from "@/core/ui/overlay/overlay-history";
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
import { describeError } from "@/core/ui/toast";

import { createGroupedProject } from "../actions/projects";
import {
  ITEMS_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  STAGES_MAX,
} from "../domain/schemas";
import { RECURRENCE_LABELS, RECURRENCES, type Recurrence } from "../domain/types";

const NONE = "__none__";

/** A stage preset as the dialog offers it (Settings → Stage presets, 7.4). */
export type PresetOption = { id: string; name: string; stages: string[] };

/**
 * A project template as the dialog offers it (Settings → Templates, 7.4). Since 6b a template may
 * carry its default `stageGroups` and its `deliverables`; one from before reads its `stages` as
 * one untitled group and its `items` as deliverables with those stages.
 */
export type TemplateOption = {
  id: string;
  name: string;
  description: string | null;
  recurrence: Recurrence;
  stages: string[];
  items: string[];
  stageGroups?: StageGroup[] | undefined;
  deliverables?: Deliverable[] | undefined;
  fieldDefaults: Record<string, unknown>;
};

/** A template's default groups and deliverables, from its new columns or its old ones. */
function templateShape(template: TemplateOption): {
  groups: StageGroup[];
  deliverables: Deliverable[];
} {
  const groups = template.stageGroups ?? groupsFromNames(template.stages);
  // A template from before deliverables: each item uses the project's defaults (its stages).
  const deliverables =
    template.deliverables ?? template.items.map((title) => ({ title, stageGroups: null }));
  return { groups, deliverables };
}

/**
 * "New project" on a client's Projects tab (7.3; PRODUCT §4.5, kickoff 7 decisions 1, 22, 23,
 * amendments A and C; 6b Release 1: ROADMAP 6b.13, 6b.16 (a)(b), 6b.18; PERMISSIONS "Screens
 * (phase 7)": `projects.manage`): optionally started from a project template (it fills the
 * recurrence, the default stage groups, the deliverables, the description and the field
 * defaults, everything still editable), a name, how often it repeats (fixed afterwards, decision
 * 4), the delivery date for a one-time project (required, amendment A), the **default stage
 * groups** (`StageGroupsEditor`: "Add from a preset" adds a group named after it), the
 * **deliverables** (`DeliverablesEditor`: a name × N, presets per deliverable; a recurring
 * project's deliverables list, copied into each new cycle) and the project fields. **A live
 * preview** of exactly what will be created: beside the form on a laptop, a **Preview** step
 * before Create on a phone (a layer of its own: back returns to the form, §14.2 a). Nothing is
 * saved until Create (`project_create_grouped`). **No billing category** (amendment C). On
 * success the new project's page is pushed and the dialog's entries backed out (§14.2 b, e).
 * Back closes it, and asks "Discard this project?" first when something was typed or picked
 * (§14.2 f); back on that keeps editing. The draft lives here, outside the `Dialog`.
 */
export type NewProjectProps = {
  clientId: string;
  presets: readonly PresetOption[];
  templates: readonly TemplateOption[];
  definitions: readonly FieldDefinition[];
  today: string;
};

export function NewProjectDialog({
  clientId,
  presets,
  templates,
  definitions,
  today,
  onClose,
}: NewProjectProps & { onClose: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"form" | "discard">("form");
  // The phone's Preview step (a layer over the form).
  const [step, setStep] = useState<"form" | "preview">("form");
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("monthly");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [groups, setGroups] = useState<StageGroup[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [description, setDescription] = useState("");
  const [customFields, setCustomFields] = useState<CustomFieldValues>({});
  const [error, setError] = useState<ResultError | null>(null);
  // Set once the project is made: the layers closing on the way out ask nothing.
  const leaving = useRef(false);

  useOverlayHistory(phase === "form" && step === "preview", () => setStep("form"));

  const action = useAction(
    async () => {
      const result = await createGroupedProject({
        clientId,
        name,
        recurrence,
        ...(recurrence === "one_time" && deliveryDate ? { deliveryDate } : {}),
        ...(description.trim() ? { description } : {}),
        stageGroups: groups,
        deliverables,
        ...(templateId ? { templateId } : {}),
        customFields,
      });
      if (!result.ok) {
        setError(result.error);
        // A refusal is shown on the form, where it can be fixed.
        if (step === "preview") backToForm();
        return;
      }
      leaving.current = true;
      const href = `/clients/${clientId}/projects/${result.data.id}`;
      const go = () => {
        nameSlide("forward");
        router.push(href, { transitionTypes: [NAV_FORWARD] });
      };
      // The Preview step's entry first, then the dialog's: neither stays under the new page.
      closeOverlaysThen(() => (step === "preview" ? closeOverlaysThen(go) : go()));
    },
    { creates: true },
  );
  const { pending } = action;
  const dirty =
    templateId !== "" ||
    name !== "" ||
    recurrence !== "monthly" ||
    deliveryDate !== "" ||
    groups.length > 0 ||
    deliverables.length > 0 ||
    description !== "" ||
    Object.values(customFields).some(
      (value) => value !== undefined && value !== null && value !== "",
    );

  function requestClose() {
    if (pending || leaving.current) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  function backToForm() {
    if (!closeOverlaysThen(() => setStep("form"))) setStep("form");
  }

  function startFrom(id: string) {
    setTemplateId(id === NONE ? "" : id);
    const template = templates.find((option) => option.id === id);
    if (!template) return;
    const shape = templateShape(template);
    setRecurrence(template.recurrence);
    setGroups(shape.groups);
    setDeliverables(shape.deliverables);
    if (!description.trim() && template.description) setDescription(template.description);
    setCustomFields((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(template.fieldDefaults)) {
        if (next[key] === undefined || next[key] === null || next[key] === "") next[key] = value;
      }
      return next;
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run();
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  const oneTime = recurrence === "one_time";
  const previewing = step === "preview";

  return (
    <>
      <Dialog
        open={phase === "form"}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <DialogContent data-slot="new-project-dialog" className="md:max-w-4xl">
          <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{previewing ? "Preview" : "New project"}</DialogTitle>
              <DialogDescription>
                {previewing
                  ? `What Create makes for ${name.trim() || "this project"}. Nothing is saved until then.`
                  : "How often it repeats can't change later. Everything else stays editable."}
              </DialogDescription>
            </DialogHeader>
            {summary ? (
              <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
            ) : null}
            {previewing ? (
              <DeliverablesPreview
                deliverables={deliverables}
                defaults={groups}
                className="md:hidden"
              />
            ) : null}
            <div
              className={
                previewing
                  ? "hidden"
                  : "grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
              }
            >
              <div className="flex min-w-0 flex-col gap-4">
                {templates.length > 0 ? (
                  <FormField
                    label="Start from"
                    hint="A template fills the rest; change anything after."
                  >
                    {(control) => (
                      <Select value={templateId || NONE} onValueChange={startFrom}>
                        <SelectTrigger
                          id={control.id}
                          className="w-full"
                          aria-describedby={control["aria-describedby"]}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>No template</SelectItem>
                          {templates.map((template) => (
                            <SelectItem key={template.id} value={template.id}>
                              {template.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </FormField>
                ) : null}
                <FormField label="Project name" error={fieldErrors.name}>
                  {(control) => (
                    <Input
                      {...control}
                      name="name"
                      value={name}
                      maxLength={PROJECT_NAME_MAX}
                      autoComplete="off"
                      onChange={(event) => setName(event.target.value)}
                      required
                    />
                  )}
                </FormField>
                <FormField label="Repeats" error={fieldErrors.recurrence}>
                  {(control) => (
                    <Select
                      value={recurrence}
                      onValueChange={(next) => setRecurrence(next as Recurrence)}
                    >
                      <SelectTrigger
                        id={control.id}
                        className="w-full"
                        aria-describedby={control["aria-describedby"]}
                        aria-invalid={control["aria-invalid"]}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RECURRENCES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {RECURRENCE_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
                {oneTime ? (
                  <FormField
                    label="Delivery date"
                    hint="When it is due to the client. You can move it later."
                    error={fieldErrors.deliveryDate}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        name="deliveryDate"
                        type="date"
                        min={today}
                        value={deliveryDate}
                        onChange={(event) => setDeliveryDate(event.target.value)}
                        required
                      />
                    )}
                  </FormField>
                ) : null}
                <section aria-labelledby="new-project-defaults" className="flex flex-col gap-2">
                  <h3 id="new-project-defaults" className="text-sm font-medium">
                    Default stage groups
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    Optional. A deliverable without its own stages starts with these. At most{" "}
                    {STAGES_MAX} stages.
                  </p>
                  <StageGroupsEditor
                    value={groups}
                    onChange={setGroups}
                    presets={presets}
                    label="Default stage groups"
                    maxStages={STAGES_MAX}
                    disabled={pending}
                  />
                  {fieldErrors.stageGroups ? (
                    <ErrorText>{fieldErrors.stageGroups}</ErrorText>
                  ) : null}
                </section>
                <section aria-labelledby="new-project-deliverables" className="flex flex-col gap-2">
                  <h3 id="new-project-deliverables" className="text-sm font-medium">
                    {oneTime ? "Deliverables" : "Deliverables list"}
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    {oneTime
                      ? `The pieces of work to deliver, at most ${ITEMS_MAX}.`
                      : `Each new cycle starts with these; rename them for the period. At most ${ITEMS_MAX}.`}
                  </p>
                  <DeliverablesEditor
                    value={deliverables}
                    onChange={setDeliverables}
                    presets={presets}
                    defaults={groups}
                    label="Deliverables"
                    maxDeliverables={ITEMS_MAX}
                    maxStages={STAGES_MAX}
                    disabled={pending}
                  />
                  {fieldErrors.deliverables ? (
                    <ErrorText>{fieldErrors.deliverables}</ErrorText>
                  ) : null}
                </section>
                <FormField label="Description" error={fieldErrors.description}>
                  {(control) => (
                    <Textarea
                      {...control}
                      name="description"
                      rows={2}
                      maxLength={PROJECT_DESCRIPTION_MAX}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  )}
                </FormField>
                <CustomFieldsForm
                  definitions={definitions}
                  values={customFields}
                  onChange={setCustomFields}
                  errors={fieldErrors}
                  disabled={pending}
                />
              </div>
              {/* The laptop's live preview, beside the form (6b.16 (a)). */}
              <aside
                className="border-border hidden min-w-0 self-start rounded-lg border p-3 md:sticky md:top-0 md:block"
                data-slot="new-project-preview"
              >
                <DeliverablesPreview deliverables={deliverables} defaults={groups} />
              </aside>
            </div>
            <ActionStatus action={action} />
            <DialogFooter>
              {previewing ? (
                <Button type="button" variant="secondary" onClick={backToForm} disabled={pending}>
                  Back to edit
                </Button>
              ) : (
                <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                  Cancel
                </Button>
              )}
              {previewing ? null : (
                // The phone's step before Create: a neutral trigger, the commit is on the step.
                <Button
                  type="button"
                  variant="strong"
                  className="md:hidden"
                  data-slot="new-project-preview-step"
                  onClick={() => setStep("preview")}
                >
                  Preview
                </Button>
              )}
              <Button
                variant="primary"
                type="submit"
                className={previewing ? undefined : "max-md:hidden"}
                pending={pending}
                pendingLabel="Creating project…"
              >
                Create project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={phase === "discard"}
        onOpenChange={(next) => {
          if (!next) setPhase("form");
        }}
        title="Discard this project?"
        description="What you typed has not been saved."
        confirmLabel="Discard project"
        cancelLabel="Keep editing"
        onConfirm={() => {
          onClose();
        }}
      />
    </>
  );
}
