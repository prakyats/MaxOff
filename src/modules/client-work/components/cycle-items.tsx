"use client";

import { CheckIcon, ChevronDownIcon, ListPlusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { bulkSummary } from "@/core/errors/bulk";
import { cn } from "@/core/lib/utils";
import { BulkBar } from "@/core/ui/composites/bulk-bar";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { replaceViewAddress } from "@/core/ui/navigation/view-address";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/core/ui/primitives/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import { Input } from "@/core/ui/primitives/input";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import {
  addItem,
  approveItems,
  markItemDone,
  markItemsDone,
  tickStageOn,
  updateItem,
} from "../actions/items";
import { movedPosition } from "../domain/positions";
import { ITEM_NOTES_MAX, ITEM_TITLE_MAX } from "../domain/schemas";
import { ITEM_STATUS } from "../domain/types";
import type { ItemView } from "../domain/views";

import { ItemSheet, type ItemPermissions } from "./item-sheet";

/**
 * A cycle's items on the project page (7.3; PRODUCT §4.5, WORKFLOWS §5.4 items 6, 7, 9, 16, 18;
 * kickoff 7 decisions 16, 26). **First glance:** each item with its planned date (red once
 * overdue), "Carried from …", a "sent back" note, its stages ticked (from `md` up; the sheet holds
 * them on a phone) and one action: **Mark done** while open, **Approve** while done (for whoever
 * approves). A tap on the title opens the item sheet. Selecting rows offers the bulk "Mark N
 * done", "Tick ‹stage› on N" and "Approve N" (decision 16: per-id results, a failed row keeps its
 * message). "Add item" adds to this cycle (never a past one, decision 9). Nothing is reordered
 * under the thumb: the server's list arrives after each change.
 */
export function CycleItems({
  cycleId,
  items,
  stages,
  permissions,
  canAdd,
  openItemId = null,
}: {
  /** An item to open on arrival (`?item=`, from the calendar's "Client items"). */
  openItemId?: string | null;
  cycleId: string;
  items: readonly ItemView[];
  stages: readonly { id: string; name: string }[];
  permissions: ItemPermissions;
  /** The cycle takes new items: not ended (or one-time), the project workable. */
  canAdd: boolean;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(openItemId);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const open = items.find((item) => item.id === openId) ?? null;
  const selectable = (item: ItemView) =>
    (permissions.tick && (item.rules.markDone || item.rules.ticks)) ||
    (permissions.approve && item.rules.decide);
  const chosen = items.filter((item) => selected.has(item.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulk(
    key: string,
    send: () => ReturnType<typeof markItemsDone>,
    verb: string,
  ): Promise<void> {
    setBusy(key);
    const result = await send();
    setBusy(null);
    if (!result.ok) {
      toastResult(result);
      return;
    }
    toast(bulkSummary(result.data, verb));
    setErrors(Object.fromEntries(result.data.failed.map((row) => [row.id, row.message])));
    setSelected(new Set(result.data.failed.map((row) => row.id)));
  }

  async function single(item: ItemView) {
    setBusy(item.id);
    if (item.rules.markDone) {
      toastResult(await markItemDone({ itemId: item.id }), { success: "Marked done" });
    } else {
      const result = await approveItems({ itemIds: [item.id] });
      if (result.ok && result.data.failed[0]) {
        setErrors((current) => ({ ...current, [item.id]: result.data.failed[0]?.message ?? "" }));
      } else toastResult(result, { success: "Approved" });
    }
    setBusy(null);
  }

  async function move(itemId: string, direction: "up" | "down") {
    const index = items.findIndex((item) => item.id === itemId);
    const position = movedPosition(items, index, direction);
    if (position === null) return;
    toastResult(await updateItem({ itemId, position }));
  }

  const doneSelected = chosen.filter((item) => item.rules.decide);
  const openSelected = chosen.filter((item) => item.rules.markDone);
  const tickable = chosen.filter((item) => item.rules.ticks);

  return (
    <section aria-labelledby="cycle-items-title" className="flex flex-col gap-2">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 id="cycle-items-title" className="text-sm font-medium">
          Items
        </h2>
        {canAdd && permissions.manage ? <AddItemDialog cycleId={cycleId} /> : null}
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={ListPlusIcon}
          size="compact"
          title="No items in this cycle."
          description={
            canAdd && permissions.manage ? "Add the pieces of work for this period." : undefined
          }
        />
      ) : (
        <ul
          aria-label="Items"
          data-slot="cycle-items"
          className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
        >
          {items.map((item) => {
            const ticked = new Set(item.ticked);
            const action =
              permissions.tick && item.rules.markDone
                ? "Mark done"
                : permissions.approve && item.rules.decide
                  ? "Approve"
                  : null;
            return (
              <li
                key={item.id}
                data-slot="item-row"
                data-state={item.state}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:px-4"
              >
                {selectable(item) ? (
                  // A 44 px target around the box (§14.1).
                  <label className="-ml-2 flex size-11 shrink-0 cursor-pointer items-center justify-center">
                    <Checkbox
                      aria-label={`Select ${item.title}`}
                      checked={selected.has(item.id)}
                      onCheckedChange={() => toggle(item.id)}
                    />
                  </label>
                ) : (
                  <span aria-hidden className="-ml-2 size-11 shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => setOpenId(item.id)}
                  data-slot="item-open"
                  className="pressable-row flex min-h-11 min-w-0 flex-[1_1_8rem] flex-col justify-center gap-0.5 text-left"
                >
                  <span
                    className={cn(
                      "text-sm font-medium break-words",
                      (item.state === "cancelled" || item.state === "carried") &&
                        "text-muted-foreground line-through",
                    )}
                  >
                    {item.title}
                  </span>
                  <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <StatusDot status={ITEM_STATUS[item.state]} />
                      {item.stateLabel}
                    </span>
                    {item.planned ? (
                      <span className={cn(item.planned.overdue && "text-destructive")}>
                        {item.planned.text}
                      </span>
                    ) : null}
                    {item.carriedFrom ? <span>{item.carriedFrom}</span> : null}
                    {stages.length > 0 ? (
                      <span className="md:hidden">
                        Stages {stages.filter((stage) => ticked.has(stage.id)).length}/
                        {stages.length}
                      </span>
                    ) : null}
                  </span>
                  {item.sentBack ? (
                    <span className="text-xs break-words" data-slot="item-row-sent-back">
                      Sent back: {item.sentBack.reason}
                    </span>
                  ) : null}
                </button>
                {stages.length > 0 ? (
                  <span className="hidden flex-wrap gap-1 md:flex" aria-label="Stages">
                    {stages.map((stage) => (
                      <span
                        key={stage.id}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                          ticked.has(stage.id)
                            ? "border-primary/40 bg-primary/10"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {ticked.has(stage.id) ? <CheckIcon className="size-3" aria-hidden /> : null}
                        {stage.name}
                      </span>
                    ))}
                  </span>
                ) : null}
                {action ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="ml-auto shrink-0"
                    pending={busy === item.id}
                    data-slot={action === "Mark done" ? "item-row-done" : "item-row-approve"}
                    onClick={() => void single(item)}
                  >
                    {action}
                  </Button>
                ) : null}
                {errors[item.id] ? (
                  <ErrorText className="basis-full">{errors[item.id]}</ErrorText>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <BulkBar count={chosen.length} onClear={() => setSelected(new Set())} noun="selected">
        {permissions.tick && openSelected.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            pending={busy === "bulk-done"}
            data-slot="bulk-mark-done"
            onClick={() =>
              void bulk(
                "bulk-done",
                () => markItemsDone({ itemIds: openSelected.map((item) => item.id) }),
                "marked done",
              )
            }
          >
            Mark {openSelected.length} done
          </Button>
        ) : null}
        {permissions.tick && stages.length > 0 && tickable.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" data-slot="bulk-tick">
                Tick a stage on {tickable.length}
                <ChevronDownIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {stages.map((stage) => (
                <DropdownMenuItem
                  key={stage.id}
                  onSelect={() =>
                    void bulk(
                      "bulk-tick",
                      () =>
                        tickStageOn({
                          stageId: stage.id,
                          itemIds: tickable.map((item) => item.id),
                        }),
                      `ticked ${stage.name}`,
                    )
                  }
                >
                  Tick {stage.name} on {tickable.length}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {permissions.approve && doneSelected.length > 0 ? (
          <Button
            variant="primary"
            size="sm"
            pending={busy === "bulk-approve"}
            pendingLabel="Approving…"
            data-slot="bulk-approve"
            onClick={() =>
              void bulk(
                "bulk-approve",
                () => approveItems({ itemIds: doneSelected.map((item) => item.id) }),
                "approved",
              )
            }
          >
            Approve {doneSelected.length}
          </Button>
        ) : null}
      </BulkBar>
      <ItemSheet
        item={open}
        stages={stages}
        permissions={permissions}
        open={open !== null}
        onOpenChange={(next) => {
          if (next) return;
          setOpenId(null);
          // An item opened from the address: closing it leaves the address on the cycle alone.
          const params = new URLSearchParams(window.location.search);
          if (params.has("item")) {
            params.delete("item");
            const query = params.toString();
            replaceViewAddress(`${window.location.pathname}${query ? `?${query}` : ""}`);
          }
        }}
        onMove={permissions.manage ? (id, direction) => void move(id, direction) : undefined}
      />
    </section>
  );
}

/** "Add item" (decision 9): a title, an optional planned date and notes, into this cycle. */
function AddItemDialog({ cycleId }: { cycleId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [planned, setPlanned] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setTitle("");
      setPlanned("");
      setNotes("");
      setError(null);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const result = await addItem({
      cycleId,
      title,
      ...(planned ? { plannedDate: planned } : {}),
      ...(notes.trim() ? { notes } : {}),
    });
    setPending(false);
    if (!result.ok) {
      const { title: heading, description } = describeError(result.error);
      const field = Object.keys(result.error.fieldErrors ?? {})[0];
      setError({ ...(field ? { field } : {}), message: description ?? heading });
      return;
    }
    toast.success("Item added");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" data-slot="add-item">
          <PlusIcon aria-hidden />
          Add item
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add an item</DialogTitle>
            <DialogDescription>
              It joins this cycle. The item list stays as it is.
            </DialogDescription>
          </DialogHeader>
          {error && !error.field ? <ErrorText slot="form-alert">{error.message}</ErrorText> : null}
          <FormField label="Title" error={error?.field === "title" ? error.message : undefined}>
            {(control) => (
              <Input
                {...control}
                name="title"
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
              <Input
                {...control}
                name="plannedDate"
                type="date"
                value={planned}
                onChange={(event) => setPlanned(event.target.value)}
              />
            )}
          </FormField>
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" pending={pending} pendingLabel="Adding…">
              Add item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
