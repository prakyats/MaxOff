"use client";

import { useState } from "react";

import { type StageGroup, stageGroupsIssue } from "@/core/lib/stage-groups";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { ReviewSheet } from "@/core/ui/composites/review-sheet";
import { Button } from "@/core/ui/primitives/button";
import type { StagePresetOption } from "@/core/ui/stage-groups/editing";
import { StageGroupsEditor } from "@/core/ui/stage-groups/stage-groups-editor";
import { describeError, toastResult } from "@/core/ui/toast";

import { updateBlueprint } from "../actions/projects";
import { STAGES_MAX } from "../domain/schemas";

/**
 * One line of the Deliverables list: its stage groups (6b Release 1; ROADMAP 6b.13, 6b.18;
 * amendment D2), over the list. A line is a plan, not a record with ticks, so its groups are
 * edited as a draft (`StageGroupsEditor`: add a group typed or from a preset, rename, remove,
 * drag groups and stages) and **saved in one change** (`project_blueprint_update` `stage_groups`,
 * which keeps the flattened `stages` in step). A line from before groups opens as one untitled
 * group. Each new cycle's deliverable made from the line starts with these; deliverables already
 * made keep theirs. Mounted while open, so it starts from the line each time; back closes it,
 * asking "Discard your changes?" first when the draft changed (§14.2 f).
 */
export function LineStagesSheet({
  line,
  presets,
  onClose,
}: {
  line: { id: string; name: string; stageGroups: readonly StageGroup[] };
  presets: readonly StagePresetOption[];
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<StageGroup[]>(() =>
    line.stageGroups.map((group) => ({ label: group.label, stages: [...group.stages] })),
  );
  const [initial] = useState(() => JSON.stringify(line.stageGroups));
  const [phase, setPhase] = useState<"edit" | "discard">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(groups) !== initial;
  const issue = stageGroupsIssue(groups);

  function requestClose(next: boolean) {
    if (next || saving) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  async function save() {
    setSaving(true);
    const result = await updateBlueprint({
      blueprintId: line.id,
      stageGroups: groups.map((group) => ({
        label: group.label === null ? null : group.label.trim(),
        stages: group.stages,
      })),
    });
    setSaving(false);
    if (!result.ok) {
      const { title, description } = describeError(result.error);
      setError(description ?? title);
      return;
    }
    toastResult(result, { success: "Stages saved" });
    onClose();
  }

  return (
    <>
      <ReviewSheet
        open={phase === "edit"}
        onOpenChange={requestClose}
        title={`Stages of ${line.name}`}
        description="Each new cycle's deliverable made from this line starts with these. Deliverables already made keep theirs."
        actions={
          <>
            <Button variant="secondary" onClick={() => requestClose(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              data-slot="line-stages-save"
              pending={saving}
              pendingLabel="Saving…"
              disabled={!dirty || issue !== null}
              onClick={() => void save()}
            >
              Save stages
            </Button>
          </>
        }
      >
        <div className="flex min-w-0 flex-col gap-3" data-slot="line-stages">
          {error ? <ErrorText slot="form-alert">{error}</ErrorText> : null}
          <StageGroupsEditor
            value={groups}
            onChange={setGroups}
            presets={presets}
            label={`Stages of ${line.name}`}
            maxStages={STAGES_MAX}
            disabled={saving}
          />
        </div>
      </ReviewSheet>
      <ConfirmDialog
        open={phase === "discard"}
        onOpenChange={(next) => (next ? null : setPhase("edit"))}
        title="Discard your changes?"
        description="The line's stages stay as they were."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => onClose()}
      />
    </>
  );
}
