"use client";

import { CheckIcon, MoreHorizontalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { fail, type Result } from "@/core/errors/result";
import {
  GROUP_LABEL_MAX,
  groupRows,
  STAGE_NAME_MAX,
  type StageGroup,
} from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { ReviewSheet } from "@/core/ui/composites/review-sheet";
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
import { linesOf, uniqueLabel, type StagePresetOption } from "@/core/ui/stage-groups/editing";
import { toastResult } from "@/core/ui/toast";

import { movedKey } from "../domain/positions";

/** A saved stage row as the sheet edits it (a project's default stage, or a deliverable's own). */
export type GroupedStageRow = {
  id: string;
  name: string;
  position: string;
  groupLabel: string | null;
  groupPosition: string | null;
  /** A deliverable's tick: shown, never changed here. Undefined for a default stage. */
  done?: boolean;
};

/** Each change is one transition function, applied at once; the server's list comes back after. */
export type GroupedStageOps = {
  addStage: (name: string, groupLabel: string | null) => Promise<Result<unknown>>;
  renameStage: (id: string, name: string) => Promise<Result<unknown>>;
  moveStage: (id: string, position: string) => Promise<Result<unknown>>;
  removeStage: (id: string) => Promise<Result<unknown>>;
  addGroup: (label: string, stages: string[]) => Promise<Result<unknown>>;
  renameGroup: (label: string | null, newLabel: string) => Promise<Result<unknown>>;
  moveGroup: (label: string, position: string) => Promise<Result<unknown>>;
  removeGroup: (label: string | null) => Promise<Result<unknown>>;
};

const NONE = "__none__";

type Removing =
  { kind: "stage"; id: string; name: string } | { kind: "group"; label: string | null };

/**
 * Stages in groups, edited live in a sheet (6b Release 1; ROADMAP 6b.13, 6b.18; DATA-MODEL §5b):
 * a project's **default stages** (⋯ → Default stages) or **one deliverable's own** (the sheet's
 * "Edit stages"). Each group sits under its heading: rename it, remove it (its stages archived),
 * drag it by its handle or Move up / down in its ⋯ menu; each stage is renamed in place, dragged
 * within its group, moved up or down, or removed. "Add a group" takes a name and one stage per
 * line; "Add from a preset" adds the preset as a new group named after it (renamable). A list
 * from before groups is **one untitled group** (no heading) with "Name this group". A
 * deliverable's ticks show beside its stages and are never touched here (they stay through every
 * rename, move and removal). Every change is one transition function, audited; nothing is
 * pre-defined. Back closes the sheet (§14.2 a); a removal's confirmation closes first; a name
 * typed and not yet sent asks "Discard what you typed?" (§14.2 f).
 */
export function GroupedStagesSheet({
  open,
  onOpenChange,
  title,
  description,
  removeStageDescription,
  removeGroupDescription,
  rows,
  presets,
  ops,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  removeStageDescription: string;
  removeGroupDescription: string;
  rows: readonly GroupedStageRow[];
  presets: readonly StagePresetOption[];
  ops: GroupedStageOps;
}) {
  const groups = groupRows(rows);
  const untitled = groups.find((group) => group.label === null);
  const named = groups.filter(
    (group): group is typeof group & { label: string } => group.label !== null,
  );
  const asGroups: StageGroup[] = groups.map((group) => ({
    label: group.label,
    stages: group.rows.map((row) => row.name),
  }));
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>({});
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [naming, setNaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newStages, setNewStages] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Removing | null>(null);
  const [asking, setAsking] = useState(false);
  const dirty =
    (naming ?? "").trim() !== "" ||
    newLabel.trim() !== "" ||
    newStages.trim() !== "" ||
    Object.values(drafts).some((draft) => draft.trim() !== "") ||
    rows.some((row) => names[row.id] !== undefined && names[row.id]?.trim() !== row.name) ||
    named.some(
      (group) => labels[group.label] !== undefined && labels[group.label]?.trim() !== group.label,
    );

  async function send(run: () => Promise<Result<unknown>>, success?: string): Promise<boolean> {
    setBusy(true);
    try {
      return toastResult(await run(), success ? { success } : {});
    } finally {
      setBusy(false);
    }
  }

  const groupReorder = useReorder({
    count: named.length,
    labelOf: (index) => named[index]?.label ?? "the group",
    onMove: (from, to) => {
      const group = named[from];
      if (!group || from === to) return;
      const order = moveItem(named, from, to);
      const position = movedKey(
        order.map((other) => other.groupPosition ?? ""),
        to,
      );
      void send(() => ops.moveGroup(group.label, position));
    },
    disabled: busy,
  });

  function requestClose(next: boolean) {
    if (!next && dirty && !busy) {
      setAsking(true);
      return;
    }
    onOpenChange(next);
  }

  function forget() {
    setNames({});
    setLabels({});
    setDrafts({});
    setNaming(null);
    setAdding(false);
    setNewLabel("");
    setNewStages("");
    setAddError(null);
  }

  async function renameGroup(from: string | null, typed: string) {
    const to = typed.trim();
    const key = from ?? "";
    if (to === "" || to === from) {
      setLabels((current) => omit(current, key));
      return;
    }
    const clash = asGroups.some(
      (group) => group.label !== null && group.label !== from && same(group.label, to),
    );
    if (clash) {
      toastResult(fail("CONFLICT", `There is already a group called ${to}.`));
      return;
    }
    await send(() => ops.renameGroup(from, to), "Renamed");
    setLabels((current) => omit(current, key));
    if (from === null) setNaming(null);
  }

  async function addStage(label: string | null) {
    const key = label ?? "";
    const typed = linesOf(drafts[key] ?? "");
    if (typed.length === 0) return;
    const group = asGroups.find((other) => other.label === label);
    for (const name of typed) {
      if (group?.stages.some((stage) => same(stage, name))) {
        toastResult(fail("CONFLICT", `This group already has a stage called ${name}.`));
        return;
      }
    }
    setBusy(true);
    try {
      for (const name of typed) {
        const result = await ops.addStage(name, label);
        if (!toastResult(result)) return;
      }
      setDrafts((current) => omit(current, key));
    } finally {
      setBusy(false);
    }
  }

  async function addGroup(label: string, stages: string[]) {
    const ok = await send(() => ops.addGroup(label, stages), `${label} added`);
    if (ok) {
      setAdding(false);
      setNewLabel("");
      setNewStages("");
      setAddError(null);
    }
  }

  function submitNewGroup() {
    const label = newLabel.trim();
    const stages = linesOf(newStages);
    if (label === "") return setAddError("Name the group.");
    if (stages.length === 0) return setAddError("Add at least one stage, one per line.");
    if (asGroups.some((group) => group.label !== null && same(group.label, label)))
      return setAddError(`There is already a group called ${label}.`);
    void addGroup(label, stages);
  }

  return (
    <>
      <ReviewSheet
        open={open && !asking}
        onOpenChange={requestClose}
        title={title}
        description={description}
      >
        <div className="flex min-w-0 flex-col gap-4" data-slot="grouped-stages">
          {rows.length === 0 ? (
            <p className="text-muted-foreground" data-slot="grouped-stages-empty">
              No stages yet. Add a group of your own, or one from your stage presets.
            </p>
          ) : null}
          {/* The untitled group (every list from before groups), or where a first stage goes. */}
          {untitled || rows.length === 0 ? (
            <div data-slot="stage-group" data-untitled="" className="flex min-w-0 flex-col gap-1">
              {naming !== null && untitled ? (
                <form
                  className="flex min-w-0 items-center gap-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void renameGroup(null, naming);
                  }}
                >
                  <Input
                    aria-label="Name of this group"
                    placeholder="Group name"
                    data-slot="untitled-group-name"
                    value={naming}
                    maxLength={GROUP_LABEL_MAX}
                    disabled={busy}
                    onChange={(event) => setNaming(event.target.value)}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    pending={busy}
                    pendingLabel="Naming…"
                    disabled={!naming.trim()}
                  >
                    Name it
                  </Button>
                </form>
              ) : null}
              <StageRows
                label={null}
                groupName="the stages"
                rows={untitled?.rows ?? []}
                busy={busy}
                names={names}
                setNames={setNames}
                send={send}
                ops={ops}
                onRemove={(row) => setRemoving({ kind: "stage", id: row.id, name: row.name })}
              />
              <AddStage
                groupName={null}
                value={drafts[""] ?? ""}
                busy={busy}
                onChange={(value) => setDrafts((current) => ({ ...current, "": value }))}
                onAdd={() => void addStage(null)}
              />
              {naming === null && untitled ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start"
                  disabled={busy}
                  data-slot="name-group"
                  onClick={() => setNaming("")}
                >
                  Name this group
                </Button>
              ) : null}
            </div>
          ) : null}
          {named.length > 0 ? (
            <ReorderList reorder={groupReorder} label={`${title}: groups`} className="gap-3">
              {named.map((group, index) => (
                <ReorderItem
                  key={group.label}
                  reorder={groupReorder}
                  index={index}
                  data-slot="stage-group"
                  className="border-border flex min-w-0 flex-col gap-1 rounded-lg border p-1.5"
                >
                  <div className="flex min-w-0 items-center gap-1">
                    <DragHandle reorder={groupReorder} index={index} />
                    <Input
                      aria-label={`Name of the group ${group.label}`}
                      placeholder="Group name"
                      data-slot="group-name"
                      value={labels[group.label] ?? group.label}
                      maxLength={GROUP_LABEL_MAX}
                      disabled={busy}
                      className="min-w-0 flex-1 font-medium"
                      onChange={(event) =>
                        setLabels((current) => ({ ...current, [group.label]: event.target.value }))
                      }
                      onBlur={() => {
                        const typed = labels[group.label];
                        if (typed !== undefined) void renameGroup(group.label, typed);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        const typed = labels[group.label];
                        if (typed !== undefined) void renameGroup(group.label, typed);
                      }}
                    />
                    <span
                      className="text-muted-foreground shrink-0 px-1 text-xs tabular-nums"
                      data-slot="group-count"
                    >
                      {group.rows.length}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-11"
                          disabled={busy}
                          aria-label={`Actions for the group ${group.label}`}
                          data-slot="group-menu"
                        >
                          <MoreHorizontalIcon aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-48">
                        <ReorderMenuItems reorder={groupReorder} index={index} />
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setRemoving({ kind: "group", label: group.label })}
                        >
                          <Trash2Icon aria-hidden />
                          Remove group
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <StageRows
                    label={group.label}
                    groupName={group.label}
                    rows={group.rows}
                    busy={busy}
                    names={names}
                    setNames={setNames}
                    send={send}
                    ops={ops}
                    onRemove={(row) => setRemoving({ kind: "stage", id: row.id, name: row.name })}
                  />
                  <AddStage
                    groupName={group.label}
                    value={drafts[group.label] ?? ""}
                    busy={busy}
                    onChange={(value) =>
                      setDrafts((current) => ({ ...current, [group.label]: value }))
                    }
                    onAdd={() => void addStage(group.label)}
                  />
                </ReorderItem>
              ))}
            </ReorderList>
          ) : null}
          {adding ? (
            <div
              data-slot="add-group-form"
              className="border-border flex min-w-0 flex-col gap-2 rounded-lg border p-3"
            >
              <p className="text-sm font-medium">New group</p>
              <Input
                aria-label="Name of the new group"
                placeholder="Group name"
                data-slot="new-group-name"
                value={newLabel}
                maxLength={GROUP_LABEL_MAX}
                disabled={busy}
                onChange={(event) => setNewLabel(event.target.value)}
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
                value={newStages}
                disabled={busy}
                onChange={(event) => setNewStages(event.target.value)}
              />
              {addError ? <ErrorText>{addError}</ErrorText> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setAdding(false);
                    setAddError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  data-slot="add-group-confirm"
                  pending={busy}
                  pendingLabel="Adding…"
                  onClick={submitNewGroup}
                >
                  Add group
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                data-slot="add-group"
                onClick={() => setAdding(true)}
              >
                <PlusIcon aria-hidden />
                Add a group
              </Button>
              {presets.length > 0 ? (
                <Select
                  value={NONE}
                  disabled={busy}
                  onValueChange={(id) => {
                    const preset = presets.find((option) => option.id === id);
                    if (preset)
                      void addGroup(uniqueLabel(asGroups, preset.name), [...preset.stages]);
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
        </div>
      </ReviewSheet>
      <ConfirmDialog
        open={asking}
        onOpenChange={(next) => (next ? null : setAsking(false))}
        title="Discard what you typed?"
        description="The stages stay as they are."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          forget();
          setAsking(false);
          onOpenChange(false);
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => (next ? null : setRemoving(null))}
        title={
          removing?.kind === "group"
            ? `Remove the group ${removing.label ?? "without a name"}?`
            : removing
              ? `Remove the stage ${removing.name}?`
              : ""
        }
        description={removing?.kind === "group" ? removeGroupDescription : removeStageDescription}
        confirmLabel={removing?.kind === "group" ? "Remove group" : "Remove stage"}
        onConfirm={async () => {
          if (!removing) return;
          const result =
            removing.kind === "group"
              ? await ops.removeGroup(removing.label)
              : await ops.removeStage(removing.id);
          const done = toastResult(result, { success: "Removed" });
          if (done) setRemoving(null);
          return done;
        }}
      />
    </>
  );
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function omit(record: Readonly<Record<string, string>>, key: string): Record<string, string> {
  const next = { ...record };
  delete next[key];
  return next;
}

/** One group's stages: drag or Move up / down within the group, rename in place, remove. */
function StageRows({
  label,
  groupName,
  rows,
  busy,
  names,
  setNames,
  send,
  ops,
  onRemove,
}: {
  label: string | null;
  groupName: string;
  rows: readonly GroupedStageRow[];
  busy: boolean;
  names: Readonly<Record<string, string>>;
  setNames: React.Dispatch<React.SetStateAction<Readonly<Record<string, string>>>>;
  send: (run: () => Promise<Result<unknown>>, success?: string) => Promise<boolean>;
  ops: GroupedStageOps;
  onRemove: (row: GroupedStageRow) => void;
}) {
  const reorder = useReorder({
    count: rows.length,
    labelOf: (index) => rows[index]?.name ?? "the stage",
    onMove: (from, to) => {
      const row = rows[from];
      if (!row || from === to) return;
      const order = moveItem(rows, from, to);
      const position = movedKey(
        order.map((other) => other.position),
        to,
      );
      void send(() => ops.moveStage(row.id, position));
    },
    disabled: busy,
  });

  async function rename(row: GroupedStageRow) {
    const typed = names[row.id];
    if (typed === undefined) return;
    const name = typed.trim();
    if (name === "" || name === row.name) {
      setNames((current) => omit(current, row.id));
      return;
    }
    if (rows.some((other) => other.id !== row.id && same(other.name, name))) {
      toastResult(fail("CONFLICT", `This group already has a stage called ${name}.`));
      return;
    }
    await send(() => ops.renameStage(row.id, name), "Renamed");
    setNames((current) => omit(current, row.id));
  }

  if (rows.length === 0) return null;
  return (
    <ReorderList
      reorder={reorder}
      label={label === null ? "Stages" : `Stages of ${groupName}`}
      className="gap-1"
    >
      {rows.map((row, index) => (
        <ReorderItem
          key={row.id}
          reorder={reorder}
          index={index}
          data-slot="stage-row"
          data-done={row.done ? "" : undefined}
          className="flex min-w-0 items-center gap-1"
        >
          <DragHandle reorder={reorder} index={index} />
          {row.done !== undefined ? (
            // The deliverable's tick, kept as it is: shown, never changed here.
            <span
              role="img"
              aria-label={row.done ? "Ticked" : "Not ticked"}
              data-slot="stage-tick-mark"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded border",
                row.done ? "border-primary bg-primary text-primary-foreground" : "border-input",
              )}
            >
              {row.done ? <CheckIcon className="size-3.5" aria-hidden /> : null}
            </span>
          ) : null}
          <Input
            aria-label={`Name of ${row.name}`}
            data-slot="stage-name"
            value={names[row.id] ?? row.name}
            maxLength={STAGE_NAME_MAX}
            disabled={busy}
            className="min-w-0 flex-1"
            onChange={(event) =>
              setNames((current) => ({ ...current, [row.id]: event.target.value }))
            }
            onBlur={() => void rename(row)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void rename(row);
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11"
                disabled={busy}
                aria-label={`Actions for ${row.name}`}
                data-slot="stage-menu"
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <ReorderMenuItems reorder={reorder} index={index} />
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onRemove(row)}>
                <Trash2Icon aria-hidden />
                Remove stage
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ReorderItem>
      ))}
    </ReorderList>
  );
}

/** The add row at a group's end: one stage, or several pasted one per line. */
function AddStage({
  groupName,
  value,
  busy,
  onChange,
  onAdd,
}: {
  /** Null: the untitled group. */
  groupName: string | null;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <form
      className="flex min-w-0 items-center gap-1 pl-12"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd();
      }}
    >
      <Input
        aria-label={groupName === null ? "Add a stage" : `Add a stage to ${groupName}`}
        placeholder="Add a stage"
        data-slot="add-stage"
        value={value}
        maxLength={STAGE_NAME_MAX}
        disabled={busy}
        className="min-w-0 flex-1"
        onChange={(event) => onChange(event.target.value)}
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="size-11"
        pending={busy}
        pendingLabel="Adding…"
        disabled={value.trim() === ""}
        aria-label={groupName === null ? "Add the stage" : `Add the stage to ${groupName}`}
      >
        <PlusIcon aria-hidden />
      </Button>
    </form>
  );
}
