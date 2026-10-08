"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  CustomFieldsForm,
  type CustomFieldValues,
} from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import type { ResultError } from "@/core/errors";
import { ActionStatus } from "@/core/ui/action/action-status";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { NAV_FORWARD } from "@/core/ui/motion/nav-types";
import { nameSlide } from "@/core/ui/motion/slide";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
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
import { describeError } from "@/core/ui/toast";

import { createProject } from "../actions/projects";
import {
  ITEMS_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  STAGES_MAX,
} from "../domain/schemas";
import { RECURRENCE_LABELS, RECURRENCES, type Recurrence } from "../domain/types";

const NONE = "__none__";
const TYPED = "__typed__";

/** A stage preset as the dialog offers it (Settings → Stage presets, 7.4). */
export type PresetOption = { id: string; name: string; stages: string[] };

/** A project template as the dialog offers it (Settings → Templates, 7.4). */
export type TemplateOption = {
  id: string;
  name: string;
  description: string | null;
  recurrence: Recurrence;
  stages: string[];
  items: string[];
  fieldDefaults: Record<string, unknown>;
};

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * "New project" on a client's Projects tab (7.3; PRODUCT §4.5, kickoff 7 decisions 1, 22, 23,
 * amendments A and C; PERMISSIONS "Screens (phase 7)": `projects.manage`): optionally started from
 * a project template (it fills the recurrence, the stages, the item list, the description and the
 * field defaults, everything still editable), a name, how often it repeats (fixed afterwards,
 * decision 4), the delivery date for a one-time project (required, amendment A), the stages from a
 * preset or typed (one per line, at most 12), the items (one per line: a recurring project's item
 * list, copied into each new cycle; a one-time project's items) and the project fields. **No
 * billing category** (amendment C: money is the Owner's, phase 9). On success the new project's
 * page is pushed and the dialog's entry backed out (§14.2 b, e). Mounted while open by
 * `NewProjectButton` (its code loads after the page, ARCHITECTURE §19). A layer (§14.2 a): back
 * closes it, and asks "Discard this project?" first when something was typed or picked
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
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("monthly");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [presetId, setPresetId] = useState("");
  const [stagesText, setStagesText] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [description, setDescription] = useState("");
  const [customFields, setCustomFields] = useState<CustomFieldValues>({});
  const [error, setError] = useState<ResultError | null>(null);

  const action = useAction(
    async () => {
      const result = await createProject({
        clientId,
        name,
        recurrence,
        ...(recurrence === "one_time" && deliveryDate ? { deliveryDate } : {}),
        ...(description.trim() ? { description } : {}),
        stages: lines(stagesText),
        items: lines(itemsText),
        ...(templateId ? { templateId } : {}),
        customFields,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const href = `/clients/${clientId}/projects/${result.data.id}`;
      closeOverlaysThen(() => {
        nameSlide("forward");
        router.push(href, { transitionTypes: [NAV_FORWARD] });
      });
    },
    { creates: true },
  );
  const { pending } = action;
  const dirty =
    templateId !== "" ||
    name !== "" ||
    recurrence !== "monthly" ||
    deliveryDate !== "" ||
    presetId !== "" ||
    stagesText !== "" ||
    itemsText !== "" ||
    description !== "" ||
    Object.values(customFields).some(
      (value) => value !== undefined && value !== null && value !== "",
    );

  function requestClose() {
    if (pending) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  function startFrom(id: string) {
    setTemplateId(id === NONE ? "" : id);
    const template = templates.find((option) => option.id === id);
    if (!template) return;
    setRecurrence(template.recurrence);
    setStagesText(template.stages.join("\n"));
    setPresetId(template.stages.length > 0 ? TYPED : "");
    setItemsText(template.items.join("\n"));
    if (!description.trim() && template.description) setDescription(template.description);
    setCustomFields((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(template.fieldDefaults)) {
        if (next[key] === undefined || next[key] === null || next[key] === "") next[key] = value;
      }
      return next;
    });
  }

  function pickPreset(id: string) {
    setPresetId(id === NONE ? "" : id);
    if (id === NONE) {
      setStagesText("");
      return;
    }
    const preset = presets.find((option) => option.id === id);
    if (preset) setStagesText(preset.stages.join("\n"));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    action.run();
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  const stageCount = lines(stagesText).length;
  const itemCount = lines(itemsText).length;
  const oneTime = recurrence === "one_time";

  return (
    <>
      <Dialog
        open={phase === "form"}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <DialogContent data-slot="new-project-dialog">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>New project</DialogTitle>
              <DialogDescription>
                How often it repeats can&apos;t change later. Everything else stays editable.
              </DialogDescription>
            </DialogHeader>
            {summary ? (
              <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
            ) : null}
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
            <FormField
              label="Stages"
              hint={`Every item gets these. One per line, at most ${STAGES_MAX}.`}
              error={fieldErrors.stages}
            >
              {(control) => (
                <div className="flex flex-col gap-2">
                  {presets.length > 0 ? (
                    <Select value={presetId || NONE} onValueChange={pickPreset}>
                      <SelectTrigger
                        id={control.id}
                        className="w-full"
                        aria-label="Stage preset"
                        aria-describedby={control["aria-describedby"]}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No stages</SelectItem>
                        {presets.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            {preset.name}
                          </SelectItem>
                        ))}
                        <SelectItem value={TYPED}>Type them</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                  <Textarea
                    {...(presets.length > 0 ? {} : control)}
                    name="stages"
                    aria-label="Stages, one per line"
                    rows={3}
                    value={stagesText}
                    onChange={(event) => {
                      setStagesText(event.target.value);
                      if (presetId && presetId !== TYPED) setPresetId(TYPED);
                    }}
                    aria-invalid={stageCount > STAGES_MAX ? true : control["aria-invalid"]}
                  />
                </div>
              )}
            </FormField>
            <FormField
              label={oneTime ? "Items" : "Item list"}
              hint={
                oneTime
                  ? `The pieces of work to deliver. One per line, at most ${ITEMS_MAX}.`
                  : `Each new cycle starts with these; rename them for the period. One per line, at most ${ITEMS_MAX}.`
              }
              error={fieldErrors.items}
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="items"
                  rows={4}
                  value={itemsText}
                  onChange={(event) => setItemsText(event.target.value)}
                  aria-invalid={itemCount > ITEMS_MAX ? true : control["aria-invalid"]}
                />
              )}
            </FormField>
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
            <ActionStatus action={action} />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
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
