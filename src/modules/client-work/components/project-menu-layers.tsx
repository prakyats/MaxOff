"use client";

import { useState } from "react";

import {
  CustomFieldsForm,
  type CustomFieldValues,
} from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import type { ResultError } from "@/core/errors";
import type { StageGroup } from "@/core/lib/stage-groups";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
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
import { Textarea } from "@/core/ui/primitives/textarea";
import type { StagePresetOption } from "@/core/ui/stage-groups/editing";
import { describeError, toastResult } from "@/core/ui/toast";

import {
  addBlueprint,
  addStage,
  addStageGroup,
  archiveBlueprint,
  archiveStage,
  archiveStageGroup,
  cancelProject,
  completeProject,
  reopenProject,
  startNextCycle,
  updateBlueprint,
  updateProject,
  updateStage,
  updateStageGroup,
} from "../actions/projects";
import {
  ITEM_TITLE_MAX,
  ITEMS_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
} from "../domain/schemas";
import type { Recurrence } from "../domain/types";

import { itemListCopy, type ItemListPeriods } from "../domain/periods";

import { saveProjectAsTemplate } from "../actions/templates";

import { GroupedStagesSheet, type GroupedStageRow } from "./grouped-stages-sheet";
import { LineStagesSheet } from "./line-stages-sheet";
import { ListEditorSheet, type ListRow } from "./list-editor-sheet";
import { SaveAsTemplateDialog } from "./save-as-template-dialog";

/** A deliverables-list line with its own stages, in groups (amendment D2; 6b). */
export type MenuBlueprint = ListRow & { stageGroups: readonly StageGroup[] };

export type MenuLayer =
  "edit" | "stages" | "items" | "next" | "template" | "complete" | "cancel" | "reopen";

export type MenuProject = {
  id: string;
  name: string;
  description: string | null;
  recurrence: Recurrence;
  deliveryDate: string | null;
  customFields: Record<string, unknown>;
};

/**
 * The ⋯ menu's layers (`ProjectMenu`), in their own chunk: loaded on the first pick and kept
 * mounted, so every later pick opens at once and every close keeps its animation. Each is its own
 * layer; back closes it (§14.2 a). The forms (Edit details, the list editors) ask before losing
 * typed work (§14.2 f).
 */
export function ProjectMenuLayers({
  layer,
  onClose,
  project,
  stages,
  blueprints,
  presets,
  definitions,
  unfinished,
  nextCycleLabel,
  itemList,
}: {
  layer: MenuLayer | null;
  onClose: () => void;
  project: MenuProject;
  stages: readonly GroupedStageRow[];
  blueprints: readonly MenuBlueprint[];
  presets: readonly StagePresetOption[];
  definitions: readonly FieldDefinition[];
  unfinished: number;
  nextCycleLabel: string | null;
  itemList: ItemListPeriods | null;
}) {
  const close = (next: boolean) => (next ? null : onClose());
  // The deliverables-list line whose own stages are open over the list (amendment D2).
  const [lineId, setLineId] = useState<string | null>(null);
  const line = blueprints.find((row) => row.id === lineId) ?? null;
  const itemWords = itemList ? itemListCopy(itemList) : null;
  const projectId = project.id;
  return (
    <>
      {layer === "edit" ? (
        <EditProjectDialog project={project} definitions={definitions} onClose={onClose} />
      ) : null}
      {layer === "template" ? (
        // 6b Release 2: a copy as a project template; mounted while open, so it starts afresh.
        <SaveAsTemplateDialog
          open
          onOpenChange={close}
          what="project"
          initialName={project.name}
          save={(name) => saveProjectAsTemplate({ projectId, name })}
        />
      ) : null}
      <GroupedStagesSheet
        open={layer === "stages"}
        onOpenChange={close}
        title="Default stages"
        description="New deliverables start with these. Existing deliverables keep their own stages; change those on the deliverable."
        removeStageDescription="New deliverables start without it. Existing deliverables keep their stages."
        removeGroupDescription="New deliverables start without its stages. Existing deliverables keep theirs."
        rows={stages}
        presets={presets}
        ops={{
          addStage: (name, groupLabel) => addStage({ projectId, name, groupLabel }),
          renameStage: (stageId, name) => updateStage({ stageId, name }),
          moveStage: (stageId, position) => updateStage({ stageId, position }),
          removeStage: (stageId) => archiveStage({ stageId }),
          addGroup: (label, names) => addStageGroup({ projectId, label, stages: names }),
          renameGroup: (label, newLabel) => updateStageGroup({ projectId, label, newLabel }),
          moveGroup: (label, position) => updateStageGroup({ projectId, label, position }),
          removeGroup: (label) => archiveStageGroup({ projectId, label }),
        }}
      />
      <ListEditorSheet
        open={layer === "items"}
        onOpenChange={close}
        title="Deliverables list"
        description={itemWords?.description ?? "Each new cycle starts with these."}
        noun="deliverable"
        removeDescription={
          itemWords?.removeDescription ??
          "Later cycles start without it. Existing deliverables don't change."
        }
        rows={blueprints}
        rowAction={(row) => (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11"
            aria-label={`Stages of ${row.name}`}
            data-slot="line-stages"
            onClick={() => setLineId(row.id)}
          >
            Stages
          </Button>
        )}
        max={ITEMS_MAX}
        maxLength={ITEM_TITLE_MAX}
        quantity
        onAdd={(title) => addBlueprint({ projectId: project.id, title })}
        addedMessage={itemWords?.added}
        onRename={(blueprintId, title) => updateBlueprint({ blueprintId, title })}
        onMove={(blueprintId, position) => updateBlueprint({ blueprintId, position })}
        onRemove={(blueprintId) => archiveBlueprint({ blueprintId })}
      />
      {layer === "items" && line !== null ? (
        <LineStagesSheet
          key={line.id}
          line={{ id: line.id, name: line.name, stageGroups: line.stageGroups }}
          presets={presets}
          onClose={() => setLineId(null)}
        />
      ) : null}
      <ConfirmDialog
        open={layer === "next"}
        onOpenChange={close}
        title={`Start ${nextCycleLabel ?? "the next cycle"} now?`}
        description="It starts with the deliverables list, so you can name the deliverables ahead."
        confirmLabel={`Start ${nextCycleLabel ?? "it"}`}
        onConfirm={async () =>
          toastResult(await startNextCycle({ projectId: project.id }), {
            success: `${nextCycleLabel ?? "The next cycle"} started`,
          })
        }
      />
      <ConfirmDialog
        open={layer === "complete"}
        onOpenChange={close}
        title={`Complete ${project.name}?`}
        description={
          unfinished > 0
            ? `${unfinished} ${unfinished === 1 ? "deliverable is" : "deliverables are"} still open. Mark ${unfinished === 1 ? "it" : "them"} done, carry or close ${unfinished === 1 ? "it" : "them"} first.`
            : "It becomes read-only. You can reopen it later."
        }
        confirmLabel="Complete project"
        confirmDisabled={unfinished > 0}
        onConfirm={async () =>
          toastResult(await completeProject({ projectId: project.id }), {
            success: "Project completed",
          })
        }
      />
      <ReasonDialog
        open={layer === "cancel"}
        onOpenChange={close}
        title={`Cancel ${project.name}?`}
        description="Every open and done deliverable is closed with your reason. Approved deliverables stay approved."
        label="Why cancel it"
        submitLabel="Cancel project"
        destructive
        // W3: never "Cancel" beside "Cancel project".
        cancelLabel="Keep project"
        onSubmit={async (reason) =>
          toastResult(await cancelProject({ projectId: project.id, reason }), {
            success: "Project cancelled",
          })
        }
      />
      <ReasonDialog
        open={layer === "reopen"}
        onOpenChange={close}
        title={`Reopen ${project.name}?`}
        description="It can be worked on again. Deliverables closed by a cancel stay closed."
        label="Why reopen it"
        submitLabel="Reopen project"
        onSubmit={async (reason) =>
          toastResult(await reopenProject({ projectId: project.id, reason }), {
            success: "Project reopened",
          })
        }
      />
    </>
  );
}

/**
 * Edit details: name, description, the one-time delivery date (amendment A) and the fields.
 * Mounted while open, so it starts from the project each time; back asks "Discard your
 * changes?" when something changed, and back on that keeps editing (§14.2 f).
 */
function EditProjectDialog({
  project,
  definitions,
  onClose,
}: {
  project: MenuProject;
  definitions: readonly FieldDefinition[];
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [deliveryDate, setDeliveryDate] = useState(project.deliveryDate ?? "");
  const [fields, setFields] = useState<CustomFieldValues>(project.customFields);
  const [initialFields] = useState(() => JSON.stringify(project.customFields));
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"form" | "discard">("form");
  const dirty =
    name !== project.name ||
    description !== (project.description ?? "") ||
    deliveryDate !== (project.deliveryDate ?? "") ||
    JSON.stringify(fields) !== initialFields;

  function requestClose() {
    if (pending) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const result = await updateProject({
      projectId: project.id,
      ...(name !== project.name ? { name } : {}),
      ...(description !== (project.description ?? "") ? { description } : {}),
      ...(project.recurrence === "one_time" && deliveryDate !== (project.deliveryDate ?? "")
        ? { deliveryDate }
        : {}),
      ...(definitions.length > 0 ? { customFields: fields } : {}),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toastResult(result, { success: "Saved" });
    onClose();
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  return (
    <>
      <Dialog
        open={phase === "form"}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent data-slot="edit-project-dialog">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Edit details</DialogTitle>
              <DialogDescription>
                How often it repeats and its client stay as they are.
              </DialogDescription>
            </DialogHeader>
            {summary ? (
              <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
            ) : null}
            <FormField label="Project name" error={fieldErrors.name}>
              {(control) => (
                <Input
                  {...control}
                  value={name}
                  maxLength={PROJECT_NAME_MAX}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              )}
            </FormField>
            {project.recurrence === "one_time" ? (
              <FormField label="Delivery date" error={fieldErrors.deliveryDate}>
                {(control) => (
                  <DateInput
                    {...control}
                    value={deliveryDate}
                    onChange={(event) => setDeliveryDate(event.target.value)}
                    required
                  />
                )}
              </FormField>
            ) : null}
            <FormField label="Description" error={fieldErrors.description}>
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={PROJECT_DESCRIPTION_MAX}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </FormField>
            <CustomFieldsForm
              definitions={definitions}
              values={fields}
              onChange={setFields}
              errors={fieldErrors}
              disabled={pending}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={requestClose}
                disabled={pending}
                data-dismiss=""
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" pending={pending} pendingLabel="Saving…">
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        destructive
        open={phase === "discard"}
        onOpenChange={(open) => {
          if (!open) setPhase("form");
        }}
        title="Discard your changes?"
        description="The project stays as it was."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          onClose();
        }}
      />
    </>
  );
}
