"use client";

import { useState } from "react";

import {
  CustomFieldsForm,
  type CustomFieldValues,
} from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import type { ResultError } from "@/core/errors";
import { fail } from "@/core/errors/result";
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
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import {
  addBlueprint,
  addStage,
  archiveBlueprint,
  archiveStage,
  cancelProject,
  completeProject,
  reopenProject,
  startNextCycle,
  updateBlueprint,
  updateProject,
  updateStage,
} from "../actions/projects";
import {
  ITEM_TITLE_MAX,
  ITEMS_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  STAGE_NAME_MAX,
  STAGES_MAX,
} from "../domain/schemas";
import type { Recurrence } from "../domain/types";

import { movedNames, nameRows } from "../domain/positions";

import { ListEditorSheet, type ListRow } from "./list-editor-sheet";

/** An item-list line with its own stages (amendment D2). */
export type MenuBlueprint = ListRow & { stages: readonly string[] };

export type MenuLayer = "edit" | "stages" | "items" | "next" | "complete" | "cancel" | "reopen";

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
  definitions,
  unfinished,
  nextCycleLabel,
}: {
  layer: MenuLayer | null;
  onClose: () => void;
  project: MenuProject;
  stages: readonly ListRow[];
  blueprints: readonly MenuBlueprint[];
  definitions: readonly FieldDefinition[];
  unfinished: number;
  nextCycleLabel: string | null;
}) {
  const close = (next: boolean) => (next ? null : onClose());
  // The item-list line whose own stages are open over the item list (amendment D2).
  const [lineId, setLineId] = useState<string | null>(null);
  const line = blueprints.find((row) => row.id === lineId) ?? null;
  const lineRows = nameRows(line?.stages ?? []);
  const setLineStages = (stages: string[]) =>
    line
      ? updateBlueprint({ blueprintId: line.id, stages })
      : Promise.resolve(fail("NOT_FOUND", "This line is gone from the list."));
  return (
    <>
      {layer === "edit" ? (
        <EditProjectDialog project={project} definitions={definitions} onClose={onClose} />
      ) : null}
      <ListEditorSheet
        open={layer === "stages"}
        onOpenChange={close}
        title="Default stages"
        description="New items start with these. Existing items keep their own stages; change those on the item."
        noun="stage"
        unique
        removeDescription="New items start without it. Existing items keep their stages."
        rows={stages}
        max={STAGES_MAX}
        maxLength={STAGE_NAME_MAX}
        onAdd={(name) => addStage({ projectId: project.id, name })}
        onRename={(stageId, name) => updateStage({ stageId, name })}
        onMove={(stageId, position) => updateStage({ stageId, position })}
        onRemove={(stageId) => archiveStage({ stageId })}
      />
      <ListEditorSheet
        open={layer === "items"}
        onOpenChange={close}
        title="Item list"
        description="Each new cycle starts with these, each with its own stages. The current cycle's items are edited on the cycle."
        noun="item"
        removeDescription="Later cycles start without it. The current cycle keeps its items."
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
        onAdd={(title) => addBlueprint({ projectId: project.id, title })}
        onRename={(blueprintId, title) => updateBlueprint({ blueprintId, title })}
        onMove={(blueprintId, position) => updateBlueprint({ blueprintId, position })}
        onRemove={(blueprintId) => archiveBlueprint({ blueprintId })}
      />
      <ListEditorSheet
        open={layer === "items" && line !== null}
        onOpenChange={(next) => (next ? null : setLineId(null))}
        title={line ? `Stages of ${line.name}` : "Stages"}
        description="Each new cycle's item made from this line starts with these. Items already made keep theirs."
        noun="stage"
        unique
        removeDescription="Later cycles' items start without it."
        rows={lineRows}
        max={STAGES_MAX}
        maxLength={STAGE_NAME_MAX}
        onAdd={(name) => setLineStages([...lineRows.map((row) => row.name), name])}
        onRename={(id, name) =>
          setLineStages(lineRows.map((row) => (row.id === id ? name : row.name)))
        }
        onMove={(id, position) => setLineStages(movedNames(lineRows, id, position))}
        onRemove={(id) =>
          setLineStages(lineRows.filter((row) => row.id !== id).map((row) => row.name))
        }
      />
      <ConfirmDialog
        open={layer === "next"}
        onOpenChange={close}
        title={`Start ${nextCycleLabel ?? "the next cycle"} now?`}
        description="It starts with the item list, so you can name the items ahead."
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
            ? `${unfinished} ${unfinished === 1 ? "item is" : "items are"} still open. Mark ${unfinished === 1 ? "it" : "them"} done, carry or close ${unfinished === 1 ? "it" : "them"} first.`
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
        description="Every open and done item is closed with your reason. Approved items stay approved."
        label="Why cancel it"
        submitLabel="Cancel project"
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
        description="It can be worked on again. Items closed by a cancel stay closed."
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
                  <Input
                    {...control}
                    type="date"
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
              <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
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
