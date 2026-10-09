"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ListOrderedIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
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
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import {
  createStagePreset,
  setStagePresetArchived,
  updateStagePreset,
} from "../actions/stage-presets";
import {
  PRESET_NAME_MAX,
  PRESET_STAGES_MAX,
  presetActions,
  stagesLine,
  type StagePreset,
} from "../domain/stage-presets";

type Viewer = { id: string; role: string };

/**
 * Settings → Stage presets (7.4; PRODUCT §4.16, kickoff 7 decision 22, PERMISSIONS ⁴): the presets
 * New project offers, shared company-wide. Everyone with `lists.manage` adds one; an Admin edits
 * and archives the ones they made, the Owner any (the seeded one belongs to nobody, so only the
 * Owner). A preset is copied into a project when chosen: changing it never touches a project.
 * Archived ones sit apart with Restore. Each row's Edit and Archive are buttons from `md` up and
 * the row's own two buttons on a phone (44 px), each opening its own layer (§14.2 a).
 */
export function StagePresetManager({
  presets,
  viewer,
  names,
}: {
  presets: readonly StagePreset[];
  viewer: Viewer;
  names: Readonly<Record<string, string>>;
}) {
  const [editing, setEditing] = useState<StagePreset | null>(null);
  const [archiving, setArchiving] = useState<StagePreset | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = presets.filter((preset) => !preset.archived);
  const archived = presets.filter((preset) => preset.archived);

  const author = (preset: StagePreset) =>
    preset.createdBy === null
      ? "built in"
      : preset.createdBy === viewer.id
        ? "by you"
        : `by ${names[preset.createdBy] ?? "someone"}`;

  async function restore(preset: StagePreset) {
    setBusyId(preset.id);
    toastResult(await setStagePresetArchived({ presetId: preset.id, archived: false }), {
      success: "Preset restored",
    });
    setBusyId(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {active.length === 0 ? (
        <EmptyState
          icon={ListOrderedIcon}
          title="No stage presets yet"
          description="Add one for a sequence projects repeat, like Script, Shoot, Edit, Posted."
        />
      ) : (
        <ul
          data-slot="stage-presets"
          className="border-border divide-border divide-y rounded-lg border"
        >
          {active.map((preset) => {
            const allowed = presetActions(preset, viewer);
            return (
              <li
                key={preset.id}
                data-slot="stage-preset"
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                <div className={cn("flex min-w-0 flex-col gap-0.5", CARD_ROW_TITLE)}>
                  <span className="truncate text-sm font-medium">{preset.name}</span>
                  <span className="text-muted-foreground text-xs break-words">
                    {stagesLine(preset.stages)} · {author(preset)}
                  </span>
                </div>
                {allowed.edit ? (
                  <div className={cn("flex items-center", CARD_ROW_TRAILING)}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${preset.name}`}
                      onClick={() => setEditing(preset)}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Archive ${preset.name}`}
                      onClick={() => setArchiving(preset)}
                    >
                      <ArchiveIcon aria-hidden />
                    </Button>
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
            Not offered in New project. Projects that used one keep their stages.
          </p>
          <ul className="border-border divide-border divide-y rounded-lg border">
            {archived.map((preset) => (
              <li
                key={preset.id}
                data-slot="archived-stage-preset"
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                <span className={cn("text-muted-foreground truncate text-sm", CARD_ROW_TITLE)}>
                  {preset.name}
                </span>
                {presetActions(preset, viewer).restore ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={CARD_ROW_TRAILING}
                    disabled={busyId !== null}
                    onClick={() => void restore(preset)}
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
        <PresetDialog key={editing.id} preset={editing} onClose={() => setEditing(null)} />
      ) : null}
      {archiving ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setArchiving(null);
          }}
          title={`Archive ${archiving.name}?`}
          description="New project stops offering it. Projects that used it keep their stages, and you can restore it later."
          confirmLabel={`Archive ${archiving.name}`}
          pendingLabel="Archiving…"
          onConfirm={async () =>
            toastResult(await setStagePresetArchived({ presetId: archiving.id, archived: true }), {
              success: "Preset archived",
            })
          }
        />
      ) : null}
    </div>
  );
}

/** The screen's one primary action, for `PageHeader` (a FAB on a phone). */
export function AddStagePresetButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="strong" onClick={() => setOpen(true)} data-slot="add-stage-preset">
        <PlusIcon aria-hidden />
        Add preset
      </Button>
      {open ? <PresetDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Add or edit a preset: a name and its stages, one per line (at most 12). */
function PresetDialog({ preset, onClose }: { preset?: StagePreset; onClose: () => void }) {
  const [name, setName] = useState(preset?.name ?? "");
  const [stages, setStages] = useState(preset?.stages.join("\n") ?? "");
  const [errors, setErrors] = useState<Readonly<Record<string, string[]>>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const values = { name, stages: stages.split("\n") };
    const result = preset
      ? await updateStagePreset({ presetId: preset.id, ...values })
      : await createStagePreset(values);
    setPending(false);
    if (!result.ok) {
      setErrors(result.error.fieldErrors ?? {});
      const { title, description } = describeError(result.error);
      setSummary(result.error.fieldErrors ? null : (description ?? title));
      return;
    }
    toastResult(result, { success: preset ? "Preset saved" : "Preset added" });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? null : onClose())}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{preset ? `Edit ${preset.name}` : "Add a stage preset"}</DialogTitle>
            <DialogDescription>
              New project copies it. Changing it later never touches a project.
            </DialogDescription>
          </DialogHeader>
          {summary ? <ErrorText slot="form-alert">{summary}</ErrorText> : null}
          <FormField label="Name" error={errors.name}>
            {(control) => (
              <Input
                {...control}
                value={name}
                maxLength={PRESET_NAME_MAX}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
              />
            )}
          </FormField>
          <FormField
            label="Stages"
            hint={`One per line, in order. At most ${PRESET_STAGES_MAX}.`}
            error={errors.stages}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={5}
                value={stages}
                onChange={(event) => setStages(event.target.value)}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" pending={pending} pendingLabel="Saving…">
              {preset ? "Save preset" : "Add preset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
