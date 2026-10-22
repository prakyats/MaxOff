"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";

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
import { ReorderNameList } from "@/core/ui/reorder/name-list";
import { describeError, toastResult } from "@/core/ui/toast";

import { createStagePreset, updateStagePreset } from "../actions/stage-presets";
import {
  PRESET_NAME_MAX,
  PRESET_STAGE_MAX,
  PRESET_STAGES_MAX,
  type StagePreset,
} from "../domain/stage-presets";

/**
 * Add or edit a preset: a name and its stages in order (at most `PRESET_STAGES_MAX`), each row
 * dragged or moved from its ⋯ menu (6b.18); saved as the list it shows.
 */
export function PresetDialog({ preset, onClose }: { preset?: StagePreset; onClose: () => void }) {
  const [name, setName] = useState(preset?.name ?? "");
  const [stages, setStages] = useState<string[]>(preset ? [...preset.stages] : [""]);
  const [errors, setErrors] = useState<Readonly<Record<string, string[]>>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const values = { name, stages };
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
          <fieldset className="flex min-w-0 flex-col gap-2" data-slot="preset-stages">
            <legend className="mb-1.5 text-sm font-medium">Stages</legend>
            <p className="text-muted-foreground text-xs">
              In order: drag a stage, or use its ⋯ menu. At most {PRESET_STAGES_MAX}.
            </p>
            <ReorderNameList
              names={stages}
              onChange={setStages}
              label="Stages"
              itemLabel={(index) => `Stage ${index + 1}`}
              removeLabel="Remove stage"
              namePrefix="stage"
              maxLength={PRESET_STAGE_MAX}
              disabled={pending}
              slot="preset-stage"
            />
            {errors.stages ? <ErrorText slot="field-error">{errors.stages[0]}</ErrorText> : null}
            {stages.length < PRESET_STAGES_MAX ? (
              <Button
                type="button"
                variant="secondary"
                className="h-11 self-start"
                disabled={pending}
                onClick={() => setStages((current) => [...current, ""])}
              >
                <PlusIcon aria-hidden />
                Add stage
              </Button>
            ) : null}
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
              data-dismiss=""
            >
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
