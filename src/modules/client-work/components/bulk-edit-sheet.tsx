"use client";

import { useState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors/result";
import type { StageGroup } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
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
import type { StagePresetOption } from "@/core/ui/stage-groups/editing";
import { StageGroupsEditor } from "@/core/ui/stage-groups/stage-groups-editor";
import { describeError } from "@/core/ui/toast";

import { addGroupsToItems, planItems, renameItems, shiftItems } from "../actions/bulk";
import { renamePreview, shiftDays, shiftWords } from "../domain/bulk";
import { itemCount } from "../domain/items";
import { scheduleDay } from "../domain/schedule";
import { ITEM_TITLE_MAX } from "../domain/schemas";

export type BulkEditKind = "plan" | "shift" | "groups" | "rename";

const TITLES: Record<BulkEditKind, string> = {
  plan: "Set planned date",
  shift: "Move planned dates",
  groups: "Add a stage group",
  rename: "Rename deliverables",
};

/** "Reel 1, Reel 2 and 3 more". */
function namesLine(items: readonly { title: string }[]): string {
  const shown = items.slice(0, 2).map((item) => item.title);
  const more = items.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(" and ");
}

/**
 * One bulk edit on the selected open deliverables (ROADMAP 6b.16 (e)), a layer of its own (a
 * bottom sheet on a phone; back closes it, then Select mode, §14.2 a): **Set planned date**,
 * **Move planned dates** by N days earlier or later (one without a date stays so), **Add a stage
 * group** (typed or from a preset, `StageGroupsEditor`) and **Rename** by a pattern ("Reel {n}",
 * numbered in the list's order, with a live preview of every new name). Each is one call: the
 * whole selection changes or none does, and the message names the deliverable that stopped it.
 */
export function BulkEditSheet({
  kind,
  items,
  presets,
  onClose,
}: {
  kind: BulkEditKind | null;
  /** The selected open deliverables, in the list's order. */
  items: readonly { id: string; title: string }[];
  presets: readonly StagePresetOption[];
  onClose: () => void;
}) {
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent data-slot="bulk-edit-sheet">
        {kind ? (
          // Keyed by kind: each edit starts empty.
          <BulkEditForm key={kind} kind={kind} items={items} presets={presets} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BulkEditForm({
  kind,
  items,
  presets,
  onClose,
}: {
  kind: BulkEditKind;
  items: readonly { id: string; title: string }[];
  presets: readonly StagePresetOption[];
  onClose: () => void;
}) {
  const [date, setDate] = useState("");
  const [days, setDays] = useState("1");
  const [later, setLater] = useState(true);
  const [groups, setGroups] = useState<StageGroup[]>([]);
  const [pattern, setPattern] = useState("");
  const [start, setStart] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const itemIds = items.map((item) => item.id);
  const count = itemCount(items.length);
  const startNumber = Number(start);
  const preview = renamePreview(pattern, items, startNumber);

  async function send<T>(call: () => Promise<Result<T>>, said: (data: T) => string) {
    setPending(true);
    const result = await call();
    setPending(false);
    if (!result.ok) {
      const { title, description } = describeError(result.error);
      setError(description ?? title);
      return;
    }
    toast.success(said(result.data));
    onClose();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (kind === "plan") {
      if (date === "") return setError("Pick a date.");
      return void send(
        () => planItems({ itemIds, plannedDate: date }),
        ({ count: changed }) => `Planned ${itemCount(changed)} for ${scheduleDay(date)}`,
      );
    }
    if (kind === "shift") {
      const shift = shiftDays(days);
      if (!shift.ok) return setError(shift.issue);
      const signed = later ? shift.days : -shift.days;
      return void send(
        () => shiftItems({ itemIds, days: signed }),
        ({ count: moved }) => shiftWords(moved, signed),
      );
    }
    if (kind === "groups") {
      if (groups.length === 0) return setError("Add a group with at least one stage.");
      if (groups.some((group) => group.label === null)) return setError("Name each group you add.");
      return void send(
        () => addGroupsToItems({ itemIds, groups }),
        ({ count: changed }) =>
          `${groups.length === 1 ? groups[0]?.label : `${groups.length} groups`} added to ${itemCount(changed)}`,
      );
    }
    if (!preview.ok) return setError(preview.issue);
    return void send(
      () => renameItems({ itemIds, pattern, start: startNumber }),
      ({ count: renamed }) => `Renamed ${itemCount(renamed)}`,
    );
  }

  const commit: Record<BulkEditKind, string> = {
    plan: `Plan ${count}`,
    shift: `Move ${count}`,
    groups: `Add to ${count}`,
    rename: `Rename ${count}`,
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{TITLES[kind]}</DialogTitle>
        <DialogDescription>
          {count}: {namesLine(items)}.
        </DialogDescription>
      </DialogHeader>
      {error ? <ErrorText slot="form-alert">{error}</ErrorText> : null}
      {kind === "plan" ? (
        <FormField label="Planned date" hint="Every selected deliverable is planned for it.">
          {(control) => (
            <Input
              {...control}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          )}
        </FormField>
      ) : null}
      {kind === "shift" ? (
        <>
          <FormField label="By how many days" hint="One without a planned date stays as it is.">
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
            )}
          </FormField>
          <div role="group" aria-label="Which way" className="flex gap-2" data-slot="shift-way">
            {[
              { value: false, label: "Earlier" },
              { value: true, label: "Later" },
            ].map((way) => (
              <Button
                key={way.label}
                type="button"
                variant={later === way.value ? "strong" : "secondary"}
                aria-pressed={later === way.value}
                className="flex-1"
                onClick={() => setLater(way.value)}
              >
                {way.label}
              </Button>
            ))}
          </div>
        </>
      ) : null}
      {kind === "groups" ? (
        <StageGroupsEditor
          value={groups}
          onChange={setGroups}
          presets={presets}
          label="Groups to add"
          disabled={pending}
        />
      ) : null}
      {kind === "rename" ? (
        <>
          <FormField
            label="New name"
            hint="{n} numbers them in the list's order; {title} keeps the current name."
          >
            {(control) => (
              <Input
                {...control}
                value={pattern}
                maxLength={ITEM_TITLE_MAX}
                autoComplete="off"
                placeholder="Name {n}"
                onChange={(event) => setPattern(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label="Start at">
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                min={0}
                max={9999}
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            )}
          </FormField>
          <section
            aria-label="New names"
            data-slot="rename-preview"
            className="flex flex-col gap-1"
          >
            <p className="text-muted-foreground text-xs">Preview</p>
            {pattern.trim() === "" ? (
              <p className="text-muted-foreground text-sm">Type a name to see the new names.</p>
            ) : preview.ok ? (
              <ul className="border-border divide-border divide-y rounded-lg border text-sm">
                {preview.rows.map((row) => (
                  <li
                    key={row.id}
                    data-slot="rename-preview-row"
                    className="flex min-w-0 flex-wrap items-baseline gap-x-2 px-3 py-2"
                  >
                    <span className="text-muted-foreground min-w-0 break-words">{row.from}</span>
                    <span aria-hidden className="text-muted-foreground">
                      →
                    </span>
                    <span
                      className={cn(
                        "min-w-0 font-medium break-words",
                        row.to === row.from && "text-muted-foreground",
                      )}
                    >
                      {row.to}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <ErrorText>{preview.issue}</ErrorText>
            )}
          </section>
        </>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          pending={pending}
          pendingLabel="Saving…"
          data-slot="bulk-edit-commit"
        >
          {commit[kind]}
        </Button>
      </DialogFooter>
    </form>
  );
}
