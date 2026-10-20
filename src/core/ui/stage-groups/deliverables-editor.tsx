"use client";

import { ChevronDownIcon, CopyIcon, MoreHorizontalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";

import {
  DELIVERABLE_TITLE_MAX,
  DELIVERABLES_MAX,
  type Deliverable,
  type DeliverableTemplateOption,
  QUANTITY_MAX,
  STAGES_MAX,
  type StageGroup,
  deliverablesIssue,
} from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
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
import { moveItem } from "@/core/ui/reorder/reorder-math";
import { DragHandle, ReorderItem, ReorderList, ReorderMenuItems } from "@/core/ui/reorder/reorder";
import { useReorder } from "@/core/ui/reorder/use-reorder";

import {
  copyGroups,
  duplicateDeliverable,
  groupsSummary,
  newDeliverables,
  removeAt,
  type StagePresetOption,
} from "./editing";
import { StageGroupsEditor } from "./stage-groups-editor";

export type DeliverablesEditorProps = {
  value: readonly Deliverable[];
  onChange: (next: Deliverable[]) => void;
  /** The Admin's own stage presets: picked ones become a new deliverable's groups. */
  presets: readonly StagePresetOption[];
  /** The default stage groups: what a deliverable with `stageGroups` null uses. */
  defaults: readonly StageGroup[];
  /**
   * The deliverable templates (6b Release 2): the add row offers them; a picked one's groups
   * become each new deliverable's own, still editable. None: the row offers no template.
   */
  deliverableTemplates?: readonly DeliverableTemplateOption[];
  /** The editor's accessible name. */
  label?: string;
  maxDeliverables?: number;
  maxStages?: number;
  disabled?: boolean;
};

/**
 * The **Deliverables** of a template or a new project (ROADMAP 6b.13, 6b.16 (b); the screens say
 * Deliverables, the tables keep `items`). The add row takes a name and "× N" (`expandQuantity`:
 * "Name 1" … "Name N"; × 1 keeps the name) and, optionally, presets that become each new one's
 * groups (none picked: it uses the default stages). Each deliverable folds open to its title and
 * its own `StageGroupsEditor`; duplicate, remove and reorder by drag (Move up / down in its ⋯
 * menu). Opening one is a view control: it adds no history (§14.2 d).
 */
export function DeliverablesEditor({
  value,
  onChange,
  presets,
  defaults,
  deliverableTemplates = [],
  label = "Deliverables",
  maxDeliverables = DELIVERABLES_MAX,
  maxStages = STAGES_MAX,
  disabled = false,
}: DeliverablesEditorProps) {
  // Which rows are open, kept in step with the rows through every add, move and removal.
  const [open, setOpen] = useState<boolean[]>([]);
  const [removing, setRemoving] = useState<number | null>(null);
  const issue = deliverablesIssue(value);

  const reorder = useReorder({
    count: value.length,
    labelOf: (index) => value[index]?.title || "the deliverable",
    onMove: (from, to) => {
      onChange(moveItem(value, from, to));
      setOpen((current) => moveItem(padded(current, value.length), from, to));
    },
    disabled,
  });

  function remove(index: number) {
    onChange(removeAt(value, index));
    setOpen((current) => removeAt(padded(current, value.length), index));
  }

  function update(index: number, next: Deliverable) {
    onChange(value.map((deliverable, at) => (at === index ? next : deliverable)));
  }

  const removingOne = removing === null ? undefined : value[removing];

  return (
    <div
      role="group"
      aria-label={label}
      data-slot="deliverables-editor"
      className="flex min-w-0 flex-col gap-3"
    >
      {value.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-slot="deliverables-empty">
          No deliverables yet. Add your own below: a name, how many, and the stages each one needs.
        </p>
      ) : (
        <ReorderList reorder={reorder} label={label} className="gap-2">
          {value.map((deliverable, index) => {
            const isOpen = open[index] ?? false;
            const title = deliverable.title || "Untitled deliverable";
            return (
              <ReorderItem
                key={index}
                reorder={reorder}
                index={index}
                data-slot="deliverable"
                className="border-border flex min-w-0 flex-col rounded-lg border"
              >
                <div className="flex min-w-0 items-center gap-1 p-1">
                  <DragHandle reorder={reorder} index={index} />
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    title={isOpen ? `Close ${title}` : `Open ${title} to edit its title and stages`}
                    data-slot="deliverable-toggle"
                    className="pressable-row flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left"
                    onClick={() =>
                      setOpen((current) => {
                        const next = padded(current, value.length);
                        next[index] = !isOpen;
                        return next;
                      })
                    }
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium" data-slot="deliverable-title">
                        {title}
                      </span>
                      <span
                        className="text-muted-foreground truncate text-xs"
                        data-slot="deliverable-subtitle"
                      >
                        {deliverable.stageGroups === null
                          ? "Uses the default stages"
                          : `Own stages · ${groupsSummary(deliverable.stageGroups)}`}
                      </span>
                    </span>
                    <ChevronDownIcon
                      aria-hidden
                      className={cn("size-4 shrink-0", isOpen && "rotate-180")}
                    />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        disabled={disabled}
                        aria-label={`Actions for ${title}`}
                        title="Move, duplicate or remove"
                        data-slot="deliverable-menu"
                      >
                        <MoreHorizontalIcon aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48">
                      <ReorderMenuItems reorder={reorder} index={index} />
                      <DropdownMenuItem
                        disabled={value.length >= maxDeliverables}
                        onSelect={() => {
                          onChange(duplicateDeliverable(value, index));
                          setOpen((current) => {
                            const next = padded(current, value.length);
                            next.splice(index + 1, 0, false);
                            return next;
                          });
                        }}
                      >
                        <CopyIcon aria-hidden />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          if (deliverable.stageGroups === null) remove(index);
                          else setRemoving(index);
                        }}
                      >
                        <Trash2Icon aria-hidden />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {isOpen ? (
                  <div
                    data-slot="deliverable-body"
                    className="border-border flex min-w-0 flex-col gap-3 border-t p-2"
                  >
                    <Input
                      aria-label="Deliverable title"
                      data-slot="deliverable-title-input"
                      value={deliverable.title}
                      maxLength={DELIVERABLE_TITLE_MAX}
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, { ...deliverable, title: event.target.value })
                      }
                    />
                    {deliverable.stageGroups === null ? (
                      <div className="flex flex-col gap-2" data-slot="uses-defaults">
                        <p className="text-muted-foreground text-sm">
                          Uses the default stages
                          {defaults.length > 0 ? ` (${groupsSummary(defaults)})` : ""}. To change
                          the stages of this deliverable only, give it its own stages.
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          className="self-start"
                          disabled={disabled}
                          onClick={() =>
                            update(index, { ...deliverable, stageGroups: copyGroups(defaults) })
                          }
                        >
                          Give it its own stages
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className="text-muted-foreground text-xs" data-slot="own-stages-note">
                          Its own stages: changes here apply to {title} only.
                        </p>
                        <StageGroupsEditor
                          value={deliverable.stageGroups}
                          onChange={(stageGroups) => update(index, { ...deliverable, stageGroups })}
                          presets={presets}
                          label={`Stages of ${title}`}
                          maxStages={maxStages}
                          disabled={disabled}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          className="self-start"
                          disabled={disabled}
                          onClick={() => update(index, { ...deliverable, stageGroups: null })}
                        >
                          Use the default stages instead
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </ReorderItem>
            );
          })}
        </ReorderList>
      )}
      {issue ? (
        <ErrorText slot="deliverables-issue" alert={false}>
          {issue}
        </ErrorText>
      ) : null}
      <AddDeliverables
        count={value.length}
        max={maxDeliverables}
        presets={presets}
        templates={deliverableTemplates}
        disabled={disabled}
        onAdd={(added) => {
          onChange([...value, ...added]);
          setOpen((current) => [...padded(current, value.length), ...added.map(() => false)]);
        }}
      />
      <ConfirmDialog
        open={removingOne !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRemoving(null);
        }}
        title={`Remove ${removingOne?.title || "this deliverable"}?`}
        description="Its stages go with it. Nothing is saved until you save."
        confirmLabel={`Remove ${removingOne?.title || "deliverable"}`}
        onConfirm={() => {
          if (removing !== null) remove(removing);
        }}
      />
    </div>
  );
}

function padded(list: readonly boolean[], length: number): boolean[] {
  return Array.from({ length }, (_, index) => list[index] ?? false);
}

const NO_TEMPLATE = "__none__";

/**
 * The add row: a name, "× N", optionally a deliverable template (its groups first) and the
 * presets that become each new deliverable's groups.
 */
function AddDeliverables({
  count,
  max,
  presets,
  templates,
  disabled,
  onAdd,
}: {
  count: number;
  max: number;
  presets: readonly StagePresetOption[];
  templates: readonly DeliverableTemplateOption[];
  disabled: boolean;
  onAdd: (added: Deliverable[]) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [picks, setPicks] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const template = templates.find((option) => option.id === templateId) ?? null;

  function pickTemplate(value: string) {
    const picked = templates.find((option) => option.id === value) ?? null;
    setTemplateId(picked ? picked.id : "");
    // The template's name, when nothing is typed yet: × N numbers it.
    if (picked && name.trim() === "") setName(picked.name);
  }

  function add() {
    const times = Number(quantity);
    if (name.trim() === "") return setError("Name the deliverable.");
    if (!Number.isInteger(times) || times < 1 || times > QUANTITY_MAX)
      return setError(`Add between 1 and ${QUANTITY_MAX} at a time.`);
    if (count + times > max) return setError(`At most ${max} deliverables.`);
    const chosen = picks
      .map((pick) => presets.find((preset) => preset.id === pick))
      .filter((preset): preset is StagePresetOption => preset !== undefined);
    onAdd(newDeliverables(name, times, chosen, template ? template.stageGroups : null));
    setName("");
    setQuantity("1");
    setPicks([]);
    setTemplateId("");
    setError(null);
  }

  return (
    <fieldset
      data-slot="add-deliverables"
      className="border-border flex min-w-0 flex-col gap-2 rounded-lg border p-3"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-medium">Add deliverables</legend>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          aria-label="Deliverable name"
          placeholder="Deliverable name"
          data-slot="new-deliverable-name"
          value={name}
          maxLength={DELIVERABLE_TITLE_MAX}
          className="min-w-0 flex-1"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            add();
          }}
        />
        <span aria-hidden className="text-muted-foreground text-sm">
          ×
        </span>
        <Input
          aria-label="How many"
          data-slot="new-deliverable-quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={QUANTITY_MAX}
          value={quantity}
          className="w-18 shrink-0"
          onChange={(event) => setQuantity(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
      </div>
      {templates.length > 0 ? (
        <Select value={templateId || NO_TEMPLATE} onValueChange={pickTemplate}>
          <SelectTrigger
            className="w-full"
            aria-label="From a deliverable template"
            data-slot="new-deliverable-template"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_TEMPLATE}>No deliverable template</SelectItem>
            {templates.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <p className="text-muted-foreground text-xs" data-slot="add-deliverables-hint">
        Tick a preset to give these deliverables their own stages, or open a deliverable&apos;s row
        to edit its stages.
      </p>
      {presets.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p id={`${id}-presets`} className="text-muted-foreground text-xs">
            Stages from your presets (optional, in the order you tick them). None ticked: the
            default stages.
          </p>
          <ul aria-labelledby={`${id}-presets`} className="flex flex-col">
            {presets.map((preset) => {
              const order = picks.indexOf(preset.id);
              return (
                <li key={preset.id}>
                  <label className="flex min-h-11 items-center gap-3 px-1 text-sm">
                    <Checkbox
                      data-slot="new-deliverable-preset"
                      checked={order >= 0}
                      onCheckedChange={(checked) =>
                        setPicks((current) =>
                          checked === true
                            ? [...current.filter((pick) => pick !== preset.id), preset.id]
                            : current.filter((pick) => pick !== preset.id),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 break-words">{preset.name}</span>
                    {order >= 0 ? (
                      <span className="text-muted-foreground text-xs">{order + 1}</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button
        type="button"
        variant="secondary"
        className="self-end"
        data-slot="add-deliverables-confirm"
        onClick={add}
      >
        <PlusIcon aria-hidden />
        Add
      </Button>
    </fieldset>
  );
}
