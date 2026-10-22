"use client";

import { MoreHorizontalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";

import {
  GROUP_LABEL_MAX,
  STAGE_NAME_MAX,
  STAGES_MAX,
  type StageGroup,
  flattenGroups,
  stageGroupsIssue,
} from "@/core/lib/stage-groups";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import { Input } from "@/core/ui/primitives/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { moveItem } from "@/core/ui/reorder/reorder-math";
import { DragHandle, ReorderItem, ReorderList, ReorderMenuItems } from "@/core/ui/reorder/reorder";
import { useReorder } from "@/core/ui/reorder/use-reorder";

import {
  addPresetGroup,
  addTypedGroup,
  hasUntitled,
  linesOf,
  removeAt,
  type StagePresetOption,
  updateGroup,
} from "./editing";

const NONE = "__none__";

export type StageGroupsEditorProps = {
  value: readonly StageGroup[];
  onChange: (next: StageGroup[]) => void;
  /** The Admin's own stage presets ("Add from a preset" adds one as a group). */
  presets: readonly StagePresetOption[];
  /** The editor's accessible name ("Default stage groups", "Item 1 stages"). */
  label: string;
  /** At most this many stages in all (`STAGES_MAX`). */
  maxStages?: number;
  disabled?: boolean;
  /** L9: false where the form gives the section its one hint (New project): no empty line. */
  hints?: boolean;
};

/**
 * A deliverable's (or a template's default) **stage groups** (ROADMAP 6b.13, 6b.18; DATA-MODEL
 * §5b): each group is a heading over its stages, from a preset ("Add from a preset" adds a group
 * named after it, renamable) or typed ("Add a group"). Groups and stages reorder by drag (Move up
 * / Move down in each row's ⋯ menu as the keyboard way); a stage moves within its group. A list
 * from before groups is **one untitled group**: no heading, only "Name this group". The first
 * thing wrong shows in `stageGroupsIssue`'s words. Nothing is pre-defined.
 */
export function StageGroupsEditor({
  value,
  onChange,
  presets,
  label,
  maxStages = STAGES_MAX,
  disabled = false,
  hints = true,
}: StageGroupsEditorProps) {
  const groups = value;
  const offset = groups[0]?.label === null ? 1 : 0;
  const untitled = offset === 1 ? groups[0] : undefined;
  const named = groups.slice(offset);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const total = flattenGroups(groups).length;
  const issue =
    stageGroupsIssue(groups) ?? (total > maxStages ? `At most ${maxStages} stages.` : null);

  const groupReorder = useReorder({
    count: named.length,
    labelOf: (index) => named[index]?.label || "the group",
    onMove: (from, to) => onChange([...(untitled ? [untitled] : []), ...moveItem(named, from, to)]),
    disabled,
  });

  function change(index: number, next: StageGroup | null) {
    if (next === null) onChange(removeAt(groups, index));
    else onChange(updateGroup(groups, index, () => next));
  }

  const removingGroup = removing === null ? undefined : groups[removing];

  return (
    <div
      role="group"
      aria-label={label}
      data-slot="stage-groups-editor"
      className="flex min-w-0 flex-col gap-3"
    >
      {groups.length === 0 && hints ? (
        <p className="text-muted-foreground text-sm" data-slot="stage-groups-empty">
          No stages yet. Add a group of your own, or one from your stage presets.
        </p>
      ) : null}
      {untitled ? (
        <div data-slot="stage-group" data-untitled="" className="flex min-w-0 flex-col gap-1">
          <StageList
            group={untitled}
            groupName={label}
            disabled={disabled}
            onChange={(next) => change(0, next.stages.length === 0 ? null : next)}
          />
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            disabled={disabled}
            data-slot="name-group"
            onClick={() => change(0, { ...untitled, label: "" })}
          >
            Name this group
          </Button>
        </div>
      ) : null}
      {named.length > 0 ? (
        <ReorderList reorder={groupReorder} label={`${label}: groups`} className="gap-3">
          {named.map((group, at) => {
            const index = at + offset;
            const name = group.label ?? "";
            return (
              <ReorderItem
                key={index}
                reorder={groupReorder}
                index={at}
                data-slot="stage-group"
                className="border-border flex min-w-0 flex-col gap-1 rounded-lg border p-1.5"
              >
                <div className="flex min-w-0 items-center gap-1">
                  <DragHandle reorder={groupReorder} index={at} />
                  <Input
                    aria-label="Group name"
                    placeholder="Group name"
                    data-slot="group-name"
                    value={name}
                    maxLength={GROUP_LABEL_MAX}
                    disabled={disabled}
                    className="font-medium"
                    onChange={(event) => change(index, { ...group, label: event.target.value })}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        disabled={disabled}
                        aria-label={`Actions for the group ${name || "without a name"}`}
                        title="Move or remove"
                        data-slot="group-menu"
                      >
                        <MoreHorizontalIcon aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48" title={name || "Group"}>
                      <ReorderMenuItems reorder={groupReorder} index={at} />
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => {
                          if (group.stages.length === 0) change(index, null);
                          else setRemoving(index);
                        }}
                      >
                        <Trash2Icon aria-hidden />
                        Remove group
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <StageList
                  group={group}
                  groupName={name || "the group"}
                  disabled={disabled}
                  onChange={(next) => change(index, next)}
                />
              </ReorderItem>
            );
          })}
        </ReorderList>
      ) : null}
      {issue ? (
        <ErrorText slot="stage-groups-issue" alert={false}>
          {issue}
        </ErrorText>
      ) : null}
      {adding ? (
        <AddGroupForm
          groups={groups}
          onCancel={() => setAdding(false)}
          onAdd={(next) => {
            onChange(next);
            setAdding(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            data-slot="add-group"
            onClick={() => setAdding(true)}
          >
            <PlusIcon aria-hidden />
            Add a group
          </Button>
          {presets.length > 0 ? (
            <Select
              value={NONE}
              disabled={disabled}
              onValueChange={(id) => {
                const preset = presets.find((option) => option.id === id);
                if (preset) onChange(addPresetGroup(groups, preset));
              }}
            >
              <SelectTrigger
                className="min-w-0 flex-1 basis-40"
                aria-label="Add from a preset"
                data-slot="add-from-preset"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Add from a preset…</SelectItem>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      )}
      <p className="text-muted-foreground text-xs" data-slot="stage-groups-count">
        {total} of {maxStages} stages
      </p>
      <ConfirmDialog
        destructive
        open={removingGroup !== undefined}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removingGroup?.label || "this group"}?`}
        description={`Its ${removingGroup?.stages.length ?? 0} stages go with it. Nothing is saved until you save.`}
        confirmLabel={`Remove ${removingGroup?.label || "group"}`}
        onConfirm={() => {
          if (removing !== null) change(removing, null);
        }}
      />
    </div>
  );
}

/** One group's stages: rename in place, drag or Move up / down, remove, add at the end. */
function StageList({
  group,
  groupName,
  disabled,
  onChange,
}: {
  group: StageGroup;
  groupName: string;
  disabled: boolean;
  onChange: (next: StageGroup) => void;
}) {
  const [draft, setDraft] = useState("");
  const reorder = useReorder({
    count: group.stages.length,
    labelOf: (index) => group.stages[index] || "the stage",
    onMove: (from, to) => onChange({ ...group, stages: moveItem(group.stages, from, to) }),
    disabled,
  });

  function add(names: readonly string[]) {
    if (names.length === 0) return;
    onChange({ ...group, stages: [...group.stages, ...names] });
    setDraft("");
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {group.stages.length > 0 ? (
        <ReorderList reorder={reorder} label={`Stages of ${groupName}`} className="gap-1">
          {group.stages.map((stage, index) => (
            <ReorderItem
              key={index}
              reorder={reorder}
              index={index}
              data-slot="stage-row"
              className="flex min-w-0 items-center gap-1"
            >
              <DragHandle reorder={reorder} index={index} />
              <Input
                aria-label={`Stage ${index + 1} of ${groupName}`}
                data-slot="stage-name"
                value={stage}
                maxLength={STAGE_NAME_MAX}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...group,
                    stages: group.stages.map((name, at) =>
                      at === index ? event.target.value : name,
                    ),
                  })
                }
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    disabled={disabled}
                    aria-label={`Actions for ${stage || "the stage"}`}
                    title="Move or remove"
                    data-slot="stage-menu"
                  >
                    <MoreHorizontalIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48" title={stage || "Stage"}>
                  <ReorderMenuItems reorder={reorder} index={index} />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => onChange({ ...group, stages: removeAt(group.stages, index) })}
                  >
                    <Trash2Icon aria-hidden />
                    Remove stage
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ReorderItem>
          ))}
        </ReorderList>
      ) : null}
      <div className="flex min-w-0 items-center gap-1 pl-12">
        <Input
          aria-label={`Add a stage to ${groupName}`}
          placeholder="Add a stage"
          data-slot="add-stage"
          value={draft}
          maxLength={STAGE_NAME_MAX}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds the stage here; it never submits the form around the editor.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            add(linesOf(draft));
          }}
          onPaste={(event) => {
            // Several lines pasted at once become several stages.
            const text = event.clipboardData.getData("text");
            if (!text.includes("\n")) return;
            event.preventDefault();
            add(linesOf(`${draft}${text}`));
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          disabled={disabled || draft.trim() === ""}
          aria-label={`Add the stage to ${groupName}`}
          title="Add the stage"
          onClick={() => add(linesOf(draft))}
        >
          <PlusIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** "Add a group": a name (blank = the untitled group, when there is none) and one stage per line. */
function AddGroupForm({
  groups,
  onAdd,
  onCancel,
}: {
  groups: readonly StageGroup[];
  onAdd: (next: StageGroup[]) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [stages, setStages] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    const names = linesOf(stages);
    if (names.length === 0) return setError("Add at least one stage, one per line.");
    if (name.trim() === "" && hasUntitled(groups))
      return setError("Give the group a name: only one group can be without a name.");
    const next = addTypedGroup(groups, name, names);
    const problem = stageGroupsIssue(next);
    if (problem) return setError(problem);
    onAdd(next);
  }

  return (
    <div
      data-slot="add-group-form"
      className="border-border flex min-w-0 flex-col gap-2 rounded-lg border p-3"
    >
      <label htmlFor={`${id}-name`} className="text-sm font-medium">
        New group
      </label>
      <Input
        id={`${id}-name`}
        placeholder="Group name"
        data-slot="new-group-name"
        value={name}
        maxLength={GROUP_LABEL_MAX}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      <Textarea
        aria-label="Stages of the new group"
        placeholder="One stage per line"
        data-slot="new-group-stages"
        rows={3}
        keyHint={false}
        value={stages}
        onChange={(event) => setStages(event.target.value)}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} data-dismiss="">
          Cancel
        </Button>
        <Button type="button" variant="secondary" data-slot="add-group-confirm" onClick={add}>
          Add group
        </Button>
      </div>
    </div>
  );
}
