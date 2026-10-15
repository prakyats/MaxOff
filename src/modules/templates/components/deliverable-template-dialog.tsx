"use client";

import { useState } from "react";

import { type StageGroup, stageGroupsIssue } from "@/core/lib/stage-groups";
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
import { DeliverablesPreview } from "@/core/ui/stage-groups/deliverables-preview";
import type { StagePresetOption } from "@/core/ui/stage-groups/editing";
import { StageGroupsEditor } from "@/core/ui/stage-groups/stage-groups-editor";
import { describeError, toastResult } from "@/core/ui/toast";
import { useIsDesktop } from "@/core/ui/viewport/use-desktop";

import {
  createDeliverableTemplate,
  updateDeliverableTemplate,
} from "../actions/deliverable-templates";
import {
  DELIVERABLE_TEMPLATE_NAME_MAX,
  type DeliverableTemplate,
} from "../domain/deliverable-templates";

type Errors = Readonly<Record<string, string[]>>;

/** What one deliverable made from the template starts with, for the preview. */
function previewOf(name: string, groups: readonly StageGroup[]) {
  return [{ title: name.trim() || "Deliverable", stageGroups: [...groups] }];
}

/**
 * Add or edit a deliverable template (6b Release 2; ROADMAP 6b.13 (2), 6b.16 (a)): its name and
 * its **stage groups** (`StageGroupsEditor`: "Add from a preset" adds a group named after it,
 * typed groups and stages, drag to reorder), with a **live preview** of the deliverable it makes:
 * beside the form on a laptop, a Preview layer before Save on a phone. Nothing is saved until
 * Save. A layer (§14.2 a): back closes the top one (the preview, then the form), and asks
 * "Discard?" first when something changed (§14.2 f); back on that keeps editing.
 */
export function DeliverableTemplateDialog({
  template,
  presets,
  onClose,
}: {
  template?: DeliverableTemplate;
  presets: readonly StagePresetOption[];
  onClose: () => void;
}) {
  const desktop = useIsDesktop();
  const [name, setName] = useState(template?.name ?? "");
  const [groups, setGroups] = useState<StageGroup[]>(template?.stageGroups ?? []);
  const [errors, setErrors] = useState<Errors>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"form" | "preview" | "discard">("form");
  const snapshot = () => JSON.stringify([name, groups]);
  const [initial] = useState(snapshot);
  const dirty = snapshot() !== initial;
  const editing = template !== undefined;
  const commitLabel = editing ? "Save template" : "Add template";
  const title = template ? `Edit ${template.name}` : "Add a deliverable template";

  function requestClose() {
    if (pending) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  function check(): boolean {
    const found: Record<string, string[]> = {};
    if (name.trim() === "") found.name = ["Name the template."];
    const problem = stageGroupsIssue(groups);
    if (problem) found.stageGroups = [problem];
    setErrors(found);
    const first = Object.values(found)[0]?.[0];
    setSummary(first ?? null);
    return first === undefined;
  }

  async function save() {
    setPending(true);
    const result = template
      ? await updateDeliverableTemplate({ templateId: template.id, name, stageGroups: groups })
      : await createDeliverableTemplate({ name, stageGroups: groups });
    setPending(false);
    if (!result.ok) {
      const fieldErrors = result.error.fieldErrors ?? {};
      setErrors(fieldErrors);
      const { title: heading, description } = describeError(result.error);
      setSummary(
        result.error.fieldErrors
          ? (Object.values(fieldErrors)[0]?.[0] ?? null)
          : (description ?? heading),
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
    if (desktop === false) setPhase("preview");
    else void save();
  }

  const deliverables = previewOf(name, groups);

  return (
    <>
      <Dialog
        open={phase !== "discard"}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent data-slot="deliverable-template-dialog" className="md:max-w-4xl">
          <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                &ldquo;+ Add deliverable&rdquo; and the project builders copy it; every deliverable
                made from it stays editable.
              </DialogDescription>
            </DialogHeader>
            {summary ? <ErrorText slot="form-alert">{summary}</ErrorText> : null}
            <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
              <div className="flex min-w-0 flex-col gap-4">
                <FormField label="Name" error={errors.name}>
                  {(control) => (
                    <Input
                      {...control}
                      value={name}
                      maxLength={DELIVERABLE_TEMPLATE_NAME_MAX}
                      onChange={(event) => setName(event.target.value)}
                      required
                      autoFocus
                    />
                  )}
                </FormField>
                <section
                  aria-labelledby="deliverable-template-groups"
                  className="flex min-w-0 flex-col gap-2"
                >
                  <h3 id="deliverable-template-groups" className="text-sm font-medium">
                    Stage groups
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    Add your presets as groups, or type your own.
                  </p>
                  <StageGroupsEditor
                    value={groups}
                    onChange={setGroups}
                    presets={presets}
                    label="Stage groups"
                    disabled={pending}
                  />
                  {errors.stageGroups && !stageGroupsIssue(groups) ? (
                    <ErrorText>{errors.stageGroups[0]}</ErrorText>
                  ) : null}
                </section>
              </div>
              <aside className="hidden min-w-0 md:block" data-slot="deliverable-template-preview">
                <div className="border-border sticky top-0 flex max-h-[calc(100dvh-12rem)] flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg border px-3 pb-3">
                  <h3 className="pt-3 text-sm font-medium">Preview</h3>
                  <DeliverablesPreview deliverables={deliverables} defaults={[]} />
                </div>
              </aside>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                Cancel
              </Button>
              {desktop === false ? (
                // pending: none — it opens the Preview layer, whose own button saves.
                <Button type="submit" variant="strong">
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
      <Dialog
        open={phase === "preview"}
        onOpenChange={(open) => {
          if (!open && !pending) setPhase("form");
        }}
      >
        <DialogContent data-slot="deliverable-template-preview-layer">
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
            <DialogDescription>
              What a deliverable made from {name.trim() || "this template"} starts with.
            </DialogDescription>
          </DialogHeader>
          <DeliverablesPreview deliverables={deliverables} defaults={[]} />
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
