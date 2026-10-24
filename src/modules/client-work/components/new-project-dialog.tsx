"use client";

import { LibraryIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  CustomFieldsForm,
  type CustomFieldValues,
} from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import type { ResultError } from "@/core/errors";
import {
  countDeliverables,
  type Deliverable,
  groupsFromNames,
  type StageGroup,
} from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { ActionStatus } from "@/core/ui/action/action-status";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { StatusBadge } from "@/core/ui/composites/status-badge";
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
import { DateInput } from "@/core/ui/primitives/date-time-input";
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
import { countsLine } from "@/core/ui/stage-groups/editing";
import { type LibraryTemplate, TemplateLibrary } from "@/core/ui/stage-groups/template-library";
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

/** The three steps (PP-forms-7, major change 2). */
const STEPS = ["basics", "deliverables", "preview"] as const;
type Step = (typeof STEPS)[number];

/** What step 1 checks before step 2: a missing name, a one-time project's delivery date. */
type BasicsErrors = { name?: string | undefined; deliveryDate?: string | undefined };

/** Each step's name: the short word, then what a laptop adds ("Deliverables" + " & stages"). */
const STEP_LABELS: Record<Step, { short: string; more: string }> = {
  basics: { short: "Basics", more: "" },
  deliverables: { short: "Deliverables", more: " & stages" },
  preview: { short: "Preview", more: " & create" },
};

const STEP_WORDS: Record<Step, string> = {
  basics: "Start from a template if you like, then name it.",
  deliverables: "What you will deliver, and the stages each one goes through.",
  preview: "What Create makes. Nothing is saved until then.",
};

/** The step that holds a refused field, so the refusal is fixed where it is shown. */
function errorStep(error: ResultError): Step {
  const fields = Object.keys(error.fieldErrors ?? {});
  if (fields.some((field) => field === "deliverables" || field === "stageGroups")) {
    return "deliverables";
  }
  return fields.length > 0 ? "basics" : "preview";
}

/**
 * "1 Basics · 2 Deliverables & stages · 3 Preview & create", the current one marked; one line on a
 * phone with the short names ("1 Basics — 2 Deliverables — 3 Preview", the approved sample).
 */
function StepsLine({ step }: { step: Step }) {
  const at = STEPS.indexOf(step);
  return (
    <ol
      data-slot="new-project-steps"
      aria-label={`Step ${at + 1} of ${STEPS.length}`}
      className="text-muted-foreground flex min-w-0 flex-nowrap items-center gap-x-2 gap-y-1 text-xs whitespace-nowrap md:flex-wrap"
    >
      {STEPS.map((one, index) => (
        <li
          key={one}
          aria-current={one === step ? "step" : undefined}
          className={cn(
            "flex min-w-0 items-center gap-2",
            one === step && "text-foreground font-semibold",
          )}
        >
          {index > 0 ? (
            <span
              aria-hidden
              className={cn("h-px w-4", index <= at ? "bg-foreground/40" : "bg-border")}
            />
          ) : null}
          <span>
            {index + 1} {STEP_LABELS[one].short}
            <span className="max-md:hidden">{STEP_LABELS[one].more}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

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
 * project's deliverables list, copied into each new cycle) and the project fields. **v1.8 V5b,
 * three steps** (PP-forms-7, major change 2, approved as shown): **1 Basics** (one "Start from a
 * template" button opens the template library, 6b.16 (f), and the chosen template shows as a
 * chip; the name, how often it repeats, the delivery date for a one-time project, the description
 * and the fields), **2 Deliverables & stages** (the editors, with the live preview beside them on
 * a laptop, 6b.16 (a)) and **3 Preview & create** (exactly what Create makes). One primary a step
 * (Next, then Create project); each later step is a layer over the one before, so back, the
 * gesture or the Back button, returns to the previous step (§14.2 a). Nothing is saved until Create
 * (`project_create_grouped`); a refusal returns to the step that holds the field. **No billing
 * category** (amendment C). On success the new project's page is pushed and the dialog's entries
 * backed out (§14.2 b, e). Back from step 1 closes it, and asks "Discard this project?" first when
 * something was typed or picked (§14.2 f); back on that keeps editing. The draft lives here,
 * outside the `Dialog`.
 */
export type NewProjectProps = {
  clientId: string;
  /** The client's name: the title says "New project · Shetty" (the approved sample). */
  clientName: string;
  presets: readonly PresetOption[];
  templates: readonly TemplateOption[];
  definitions: readonly FieldDefinition[];
  today: string;
};

export function NewProjectDialog({
  clientId,
  clientName,
  presets,
  templates,
  definitions,
  today,
  onClose,
}: NewProjectProps & { onClose: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"form" | "discard">("form");
  // The three steps (PP-forms-7, major change 2): each later step a layer over the one before, so
  // back (the gesture or the Back button) returns to the previous step (§14.2 a).
  const [step, setStep] = useState<Step>("basics");
  // The name and delivery date are checked before step 2 (the database checks again on Create).
  const [basicsError, setBasicsError] = useState<BasicsErrors>({});
  const [templateId, setTemplateId] = useState("");
  // The template library (6b.16 (f)): search and a preview before using one.
  const [library, setLibrary] = useState(false);
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

  const at = STEPS.indexOf(step);
  useOverlayHistory(phase === "form" && at >= 1, () => setStep("basics"));
  useOverlayHistory(phase === "form" && at >= 2, () => setStep("deliverables"));

  const libraryTemplates: LibraryTemplate[] = templates.map((template) => {
    const shape = templateShape(template);
    return {
      id: template.id,
      name: template.name,
      line: `${RECURRENCE_LABELS[template.recurrence]} · ${countsLine(
        countDeliverables(shape.deliverables, shape.groups),
      )}`,
      deliverables: shape.deliverables,
      defaults: shape.groups,
    };
  });

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
        // A refusal is shown on the step that holds the field, where it can be fixed.
        backTo(errorStep(result.error));
        return;
      }
      leaving.current = true;
      const href = `/clients/${clientId}/projects/${result.data.id}`;
      const go = () => {
        nameSlide("forward");
        router.push(href, { transitionTypes: [NAV_FORWARD] });
      };
      // The steps' entries first, then the dialog's: none stays under the new page.
      backOut(at, () => closeOverlaysThen(go));
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

  /** Backs out `count` step entries, one traversal at a time, then runs `then`. */
  function backOut(count: number, then: () => void) {
    if (count <= 0) {
      then();
      return;
    }
    if (!closeOverlaysThen(() => backOut(count - 1, then))) backOut(count - 1, then);
  }

  /** Back to an earlier step (the Back button, or a refusal to fix there). */
  function backTo(target: Step) {
    const steps = at - STEPS.indexOf(target);
    if (steps <= 0) return;
    backOut(steps, () => setStep(target));
  }

  function next() {
    if (step === "basics") {
      const problems: BasicsErrors = {};
      if (!name.trim()) problems.name = "Give the project a name.";
      if (recurrence === "one_time" && !deliveryDate) {
        problems.deliveryDate = "Choose the delivery date.";
      }
      setBasicsError(problems);
      if (problems.name || problems.deliveryDate) return;
      setStep("deliverables");
    } else if (step === "deliverables") {
      setStep("preview");
    }
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
    // Enter in a field moves on a step; Create commits only on the last.
    if (step === "preview") action.run();
    else next();
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  const oneTime = recurrence === "one_time";
  const chosen = templates.find((template) => template.id === templateId) ?? null;
  const chosenShape = chosen ? templateShape(chosen) : null;

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
              <DialogTitle>New project · {clientName}</DialogTitle>
              <DialogDescription>{STEP_WORDS[step]}</DialogDescription>
            </DialogHeader>
            <StepsLine step={step} />
            {summary ? (
              <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
            ) : null}

            {/* 1 Basics: start from a template, the name, how often it repeats. */}
            <div
              data-slot="new-project-basics"
              className={step === "basics" ? "flex min-w-0 flex-col gap-4" : "hidden"}
            >
              {templates.length > 0 ? (
                <div className="flex min-w-0 flex-col items-start gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    data-slot="browse-templates"
                    onClick={() => setLibrary(true)}
                  >
                    <LibraryIcon aria-hidden />
                    {chosen ? "Change template" : "Start from a template"}
                  </Button>
                  {chosen && chosenShape ? (
                    <span className="flex max-w-full flex-wrap items-center gap-2">
                      <StatusBadge
                        status="template"
                        tone="info"
                        label={`${chosen.name} · ${countsLine(
                          countDeliverables(chosenShape.deliverables, chosenShape.groups),
                        )}`}
                        className="h-auto max-w-full py-0.5 whitespace-normal"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        data-slot="clear-template"
                        onClick={() => setTemplateId("")}
                      >
                        Don&apos;t use a template
                      </Button>
                    </span>
                  ) : null}
                </div>
              ) : null}
              <FormField label="Project name" error={basicsError.name ?? fieldErrors.name}>
                {(control) => (
                  <Input
                    {...control}
                    name="name"
                    value={name}
                    maxLength={PROJECT_NAME_MAX}
                    autoComplete="off"
                    onChange={(event) => {
                      setName(event.target.value);
                      setBasicsError((current) => ({ ...current, name: undefined }));
                    }}
                    required
                  />
                )}
              </FormField>
              <FormField
                label="Repeats"
                hint="This can't change later."
                error={fieldErrors.recurrence}
              >
                {(control) => (
                  <Select
                    value={recurrence}
                    onValueChange={(value) => setRecurrence(value as Recurrence)}
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
                  error={basicsError.deliveryDate ?? fieldErrors.deliveryDate}
                >
                  {(control) => (
                    <DateInput
                      {...control}
                      name="deliveryDate"
                      min={today}
                      value={deliveryDate}
                      onChange={(event) => {
                        setDeliveryDate(event.target.value);
                        setBasicsError((current) => ({ ...current, deliveryDate: undefined }));
                      }}
                      required
                    />
                  )}
                </FormField>
              ) : null}
              <FormField label="Description (optional)" error={fieldErrors.description}>
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

            {/* 2 Deliverables & stages, with the live preview beside them on a laptop. */}
            <div
              data-slot="new-project-deliverables-step"
              className={
                step === "deliverables"
                  ? "grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
                  : "hidden"
              }
            >
              <div className="flex min-w-0 flex-col gap-4">
                <section aria-labelledby="new-project-deliverables" className="flex flex-col gap-2">
                  <h3 id="new-project-deliverables" className="text-sm font-medium">
                    {oneTime ? "Deliverables" : "Deliverables list"}
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    {oneTime
                      ? "What you will deliver: a name, how many, and their stages."
                      : "Each new period starts with these: a name, how many, and their stages."}
                  </p>
                  <DeliverablesEditor
                    hints={false}
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
                <section aria-labelledby="new-project-defaults" className="flex flex-col gap-2">
                  <h3 id="new-project-defaults" className="text-sm font-medium">
                    Default stage groups
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    Optional: deliverables without their own stages start with these.
                  </p>
                  <StageGroupsEditor
                    hints={false}
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
              </div>
              <aside
                className="border-border hidden min-w-0 self-start rounded-lg border p-3 md:sticky md:top-0 md:block"
                data-slot="new-project-preview"
              >
                <DeliverablesPreview deliverables={deliverables} defaults={groups} />
              </aside>
            </div>

            {/* 3 Preview & create: exactly what Create makes. */}
            {step === "preview" ? (
              <div data-slot="new-project-preview-step" className="flex min-w-0 flex-col gap-3">
                <DeliverablesPreview deliverables={deliverables} defaults={groups} />
                <p className="text-muted-foreground text-sm" data-slot="new-project-note">
                  {[
                    oneTime ? null : "Each new period starts with this deliverables list.",
                    templateId
                      ? "Templates are copies: changing one later never changes this project."
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ") || "Nothing is saved until you create it."}
                </p>
              </div>
            ) : null}

            <ActionStatus action={action} />
            {/* One primary a step: Next, then Create project; Back (or Cancel on step 1). */}
            {/* Back and Next side by side on a phone from step 2 (the approved sample). */}
            <DialogFooter className={cn(step !== "basics" && "max-md:grid max-md:grid-cols-2")}>
              {step === "basics" ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={requestClose}
                  disabled={pending}
                  data-dismiss=""
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  data-slot="new-project-back"
                  onClick={() => backTo(step === "preview" ? "deliverables" : "basics")}
                  disabled={pending}
                >
                  Back
                </Button>
              )}
              {step === "preview" ? (
                <Button
                  variant="primary"
                  type="submit"
                  pending={pending}
                  pendingLabel="Creating project…"
                >
                  Create project
                </Button>
              ) : (
                // pending: none (moves to the next step; Create project on the last commits)
                <Button type="submit" variant="strong" data-slot="new-project-next">
                  Next
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {templates.length > 0 ? (
        <TemplateLibrary
          open={phase === "form" && library}
          onOpenChange={setLibrary}
          templates={libraryTemplates}
          onUse={(id) => {
            setLibrary(false);
            startFrom(id);
          }}
        />
      ) : null}
      <ConfirmDialog
        destructive
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
