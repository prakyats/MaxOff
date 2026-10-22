"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getInBackground } from "@/core/http/background";
import {
  type DeliverableTemplateOption,
  type StageGroup,
  stageGroupsIssue,
} from "@/core/lib/stage-groups";
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
import { DateInput } from "@/core/ui/primitives/date-time-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { copyGroups } from "@/core/ui/stage-groups/editing";
import { StageGroupsEditor } from "@/core/ui/stage-groups/stage-groups-editor";
import { describeError } from "@/core/ui/toast";

import { addItem } from "../actions/items";
import { addGroupedItem } from "../actions/templates";
import { ITEM_NOTES_MAX, ITEM_TITLE_MAX } from "../domain/schemas";

const NO_TEMPLATE = "__none__";

/**
 * "Add item" (decision 9): a title, an optional planned date and notes, into this cycle. **6b
 * Release 2:** "Start from" a deliverable template (read when the dialog opens): its stage groups
 * fill the deliverable, editable here before adding (`item_add_grouped`); none picked, it starts
 * with the project's default stages as before. Mounted
 * while open (its code loads on the first tap, ARCHITECTURE §19). A layer (§14.2 a): back closes
 * it, and asks "Discard this item?" first when something was typed (§14.2 f); back on that keeps
 * editing.
 */
export function AddItemDialog({
  cycleId,
  defaultStages,
  onClose,
}: {
  cycleId: string;
  /** How many default stages it starts with (6b.13: the dialog says so). */
  defaultStages: number;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [planned, setPlanned] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"form" | "discard">("form");
  const [templates, setTemplates] = useState<readonly DeliverableTemplateOption[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [groups, setGroups] = useState<StageGroup[]>([]);
  const dirty = title !== "" || planned !== "" || notes !== "" || templateId !== "";

  // The deliverable templates, once per opening; without them the dialog is as before.
  useEffect(() => {
    let live = true;
    // A plain request, never a server action (ARCHITECTURE §4.4): an effect sends it.
    void getInBackground<DeliverableTemplateOption[]>(
      "/api/client-work/deliverable-templates",
      {},
    ).then((result) => {
      if (live && result.ok) setTemplates(result.data);
    });
    return () => {
      live = false;
    };
  }, []);

  function startFrom(value: string) {
    const picked = templates.find((template) => template.id === value) ?? null;
    setTemplateId(picked ? picked.id : "");
    setGroups(picked ? copyGroups(picked.stageGroups) : []);
    if (picked && title.trim() === "") setTitle(picked.name);
  }

  function requestClose() {
    if (pending) return;
    if (dirty) setPhase("discard");
    else onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = templateId ? stageGroupsIssue(groups) : null;
    if (problem) {
      setError({ message: problem });
      return;
    }
    setPending(true);
    const values = {
      cycleId,
      title,
      ...(planned ? { plannedDate: planned } : {}),
      ...(notes.trim() ? { notes } : {}),
    };
    const result = templateId
      ? await addGroupedItem({ ...values, stageGroups: groups })
      : await addItem(values);
    setPending(false);
    if (!result.ok) {
      const { title: heading, description } = describeError(result.error);
      const field = Object.keys(result.error.fieldErrors ?? {})[0];
      setError({ ...(field ? { field } : {}), message: description ?? heading });
      return;
    }
    toast.success("Deliverable added");
    onClose();
  }

  return (
    <>
      <Dialog
        open={phase === "form"}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent data-slot="add-item-dialog">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Add a deliverable</DialogTitle>
              <DialogDescription>
                {templateId
                  ? "It joins this cycle with the stages below. The deliverables list stays as it is."
                  : defaultStages > 0
                    ? `It joins this cycle with the project's ${defaultStages} default ${defaultStages === 1 ? "stage" : "stages"}. The deliverables list stays as it is.`
                    : "It joins this cycle. The deliverables list stays as it is."}
              </DialogDescription>
            </DialogHeader>
            {error && !error.field ? (
              <ErrorText slot="form-alert">{error.message}</ErrorText>
            ) : null}
            {templates.length > 0 ? (
              <FormField
                label="Start from"
                hint="A deliverable template gives its stage groups; change them below."
              >
                {(control) => (
                  <Select value={templateId || NO_TEMPLATE} onValueChange={startFrom}>
                    <SelectTrigger
                      id={control.id}
                      className="w-full"
                      aria-describedby={control["aria-describedby"]}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TEMPLATE}>The project&apos;s default stages</SelectItem>
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
            <FormField label="Title" error={error?.field === "title" ? error.message : undefined}>
              {(control) => (
                <Input
                  {...control}
                  name="title"
                  placeholder="Deliverable name"
                  value={title}
                  maxLength={ITEM_TITLE_MAX}
                  autoComplete="off"
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  autoFocus
                />
              )}
            </FormField>
            <FormField
              label="Planned date"
              hint="Optional. It shows on the calendar and is overdue once passed."
              error={error?.field === "plannedDate" ? error.message : undefined}
            >
              {(control) => (
                <DateInput
                  {...control}
                  name="plannedDate"
                  value={planned}
                  onChange={(event) => setPlanned(event.target.value)}
                />
              )}
            </FormField>
            {templateId ? (
              <section
                aria-label="Its stages"
                data-slot="add-item-stages"
                className="flex min-w-0 flex-col gap-2"
              >
                <p className="text-sm font-medium">Its stages</p>
                <StageGroupsEditor
                  value={groups}
                  onChange={setGroups}
                  presets={[]}
                  label={`Stages of ${title.trim() || "the new deliverable"}`}
                  disabled={pending}
                />
              </section>
            ) : null}
            <FormField label="Notes">
              {(control) => (
                <Textarea
                  {...control}
                  name="notes"
                  rows={2}
                  maxLength={ITEM_NOTES_MAX}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              )}
            </FormField>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" pending={pending} pendingLabel="Adding…">
                Add deliverable
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
        title="Discard this deliverable?"
        description="What you typed has not been saved."
        confirmLabel="Discard deliverable"
        cancelLabel="Keep editing"
        onConfirm={() => {
          onClose();
        }}
      />
    </>
  );
}
