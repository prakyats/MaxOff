"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";

import {
  CustomFieldsForm,
  type CustomFieldValues,
} from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import type { ResultError } from "@/core/errors";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
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
import type { ProjectState, Recurrence } from "../domain/types";

import { ListEditorSheet, type ListRow } from "./list-editor-sheet";

type Layer = "edit" | "stages" | "items" | "next" | "complete" | "cancel" | "reopen" | null;

/**
 * A project's ⋯ menu (7.3 / 7.4; WORKFLOWS §5.4 items 3, 8, 9, 14, 19; PERMISSIONS "Screens
 * (phase 7)"): **Edit details** (name, description, the one-time delivery date, the project
 * fields), **Stages** and the **Item list** (recurring only) in a sheet, **Start next cycle**
 * (recurring, at most 7 days early) for `projects.manage`; **Complete** (refused while anything is
 * open or done: the dialog says what is left), **Cancel** with a reason (it closes the open and
 * done items) and **Reopen** with a reason (refused on an Inactive client) for `projects.complete`.
 * Each opens its own layer; back closes it (§14.2 a). The function behind each decides again.
 */
export function ProjectMenu({
  project,
  stages,
  blueprints,
  definitions,
  canManage,
  canComplete,
  unfinished,
  nextCycleLabel,
}: {
  project: {
    id: string;
    name: string;
    description: string | null;
    recurrence: Recurrence;
    state: ProjectState;
    deliveryDate: string | null;
    customFields: Record<string, unknown>;
  };
  stages: readonly ListRow[];
  blueprints: readonly ListRow[];
  definitions: readonly FieldDefinition[];
  canManage: boolean;
  canComplete: boolean;
  /** How many items of the project are still open or done (complete is refused while any are). */
  unfinished: number;
  /** "November 2026": the period "Start next cycle" would begin, when it may start now. */
  nextCycleLabel: string | null;
}) {
  const [layer, setLayer] = useState<Layer>(null);
  const working = project.state === "open" || project.state === "in_progress";
  const recurring = project.recurrence !== "one_time";
  const close = (next: boolean) => (next ? null : setLayer(null));

  const entries = [
    canManage && working ? { key: "edit", label: "Edit details" } : null,
    canManage && working ? { key: "stages", label: "Stages" } : null,
    canManage && working && recurring ? { key: "items", label: "Item list" } : null,
    canManage && working && recurring && nextCycleLabel
      ? { key: "next", label: `Start ${nextCycleLabel}` }
      : null,
  ].filter((entry): entry is { key: Exclude<Layer, null>; label: string } => entry !== null);
  const lifecycle = [
    canComplete && working ? { key: "complete", label: "Complete project" } : null,
    canComplete && working ? { key: "cancel", label: "Cancel project…" } : null,
    canComplete && !working ? { key: "reopen", label: "Reopen project…" } : null,
  ].filter((entry): entry is { key: Exclude<Layer, null>; label: string } => entry !== null);
  if (entries.length === 0 && lifecycle.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${project.name}`}
            data-slot="project-menu"
            className="size-11 md:size-8"
          >
            <MoreHorizontalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {entries.map((entry) => (
            <DropdownMenuItem key={entry.key} onSelect={() => setLayer(entry.key)}>
              {entry.label}
            </DropdownMenuItem>
          ))}
          {entries.length > 0 && lifecycle.length > 0 ? <DropdownMenuSeparator /> : null}
          {lifecycle.map((entry) => (
            <DropdownMenuItem key={entry.key} onSelect={() => setLayer(entry.key)}>
              {entry.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditProjectDialog
        open={layer === "edit"}
        onOpenChange={close}
        project={project}
        definitions={definitions}
      />
      <ListEditorSheet
        open={layer === "stages"}
        onOpenChange={close}
        title="Stages"
        description="Every item of the project gets these. A change applies to every cycle."
        noun="stage"
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
        description="Each new cycle starts with these. The current cycle's items are edited on the cycle."
        noun="item"
        rows={blueprints}
        max={ITEMS_MAX}
        maxLength={ITEM_TITLE_MAX}
        onAdd={(title) => addBlueprint({ projectId: project.id, title })}
        onRename={(blueprintId, title) => updateBlueprint({ blueprintId, title })}
        onMove={(blueprintId, position) => updateBlueprint({ blueprintId, position })}
        onRemove={(blueprintId) => archiveBlueprint({ blueprintId })}
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
            ? `${unfinished} ${unfinished === 1 ? "item is" : "items are"} still open or done. Approve, carry, close or cancel ${unfinished === 1 ? "it" : "them"} first.`
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

/** Edit details: name, description, the one-time delivery date (amendment A) and the fields. */
function EditProjectDialog({
  open,
  onOpenChange,
  project,
  definitions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: {
    id: string;
    name: string;
    description: string | null;
    recurrence: Recurrence;
    deliveryDate: string | null;
    customFields: Record<string, unknown>;
  };
  definitions: readonly FieldDefinition[];
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [deliveryDate, setDeliveryDate] = useState(project.deliveryDate ?? "");
  const [fields, setFields] = useState<CustomFieldValues>(project.customFields);
  const [error, setError] = useState<ResultError | null>(null);
  const [pending, setPending] = useState(false);

  function change(next: boolean) {
    if (pending) return;
    if (next) {
      setName(project.name);
      setDescription(project.description ?? "");
      setDeliveryDate(project.deliveryDate ?? "");
      setFields(project.customFields);
      setError(null);
    }
    onOpenChange(next);
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
    onOpenChange(false);
  }

  const fieldErrors = error?.fieldErrors ?? {};
  const summary = error && !error.fieldErrors ? describeError(error) : null;
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => change(false)}
              disabled={pending}
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
  );
}
