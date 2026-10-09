"use client";

import { CheckIcon, ChevronDownIcon, ListPlusIcon, PlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";

import { bulkSummary } from "@/core/errors/bulk";
import { cn } from "@/core/lib/utils";
import { BulkBar } from "@/core/ui/composites/bulk-bar";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ErrorText } from "@/core/ui/composites/error-text";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { replaceViewAddress } from "@/core/ui/navigation/view-address";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import { toastResult } from "@/core/ui/toast";

import { markItemsDone, tickStages, updateItem } from "../actions/items";
import { itemCount, stageChoices } from "../domain/items";
import { movedPosition } from "../domain/positions";
import { ITEM_STATUS } from "../domain/types";
import type { ItemView } from "../domain/views";

import type { ItemPermissions } from "./item-sheet";
import { MARK_DONE_URL, useUndoSends } from "./use-undo-sends";

/**
 * What draws nothing until it is used loads after the page (ARCHITECTURE §19, the 7B review's
 * S2): the item sheet and the bulk Mark done's confirmation are mounted on their first open and
 * kept (their closing stays animated); Add item is mounted while open.
 */
const ItemSheet = dynamic(() => import("./item-sheet").then((module) => module.ItemSheet), {
  ssr: false,
});
const AddItemDialog = dynamic(
  () => import("./add-item-dialog").then((module) => module.AddItemDialog),
  { ssr: false },
);
const ConfirmDialog = dynamic(
  () => import("@/core/ui/composites/confirm-dialog").then((module) => module.ConfirmDialog),
  { ssr: false },
);

/**
 * A cycle's items on the project page (7.3; PRODUCT §4.5, WORKFLOWS §5.4 items 7, 9, 16, 18;
 * kickoff 7 decisions 16, 26; amendment D). **First glance:** each item with its planned date (red
 * once overdue), "Carried from …", a "sent back" note, its own stages ticked (from `md` up; the
 * sheet holds them on a phone) and one action: **Mark done** while open, for whoever ticks. Done
 * is the approval (D3): it locks the item and counts it at once, so it is instant with the
 * 6-second Undo (Today's own delayed send); the sheet's Mark done too. A tap on the title opens the
 * item sheet. Selecting rows offers the bulk "Mark N done" (it asks first, its red button naming
 * it, "Mark 5 items done") and "Tick ‹stage› on N" for the selected items that have a stage of
 * that name (decision 16: per-id results, a failed row keeps its message). "Add item" adds to this
 * cycle (never a past one, decision 9). Nothing is reordered under the thumb: the server's list
 * arrives after each change.
 */
export function CycleItems({
  cycleId,
  items,
  permissions,
  canAdd,
  openItemId = null,
}: {
  /** An item to open on arrival (`?item=`, from the calendar's "Client items"). */
  openItemId?: string | null;
  cycleId: string;
  items: readonly ItemView[];
  permissions: ItemPermissions;
  /** The cycle takes new items: not ended (or one-time), the project workable. */
  canAdd: boolean;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(openItemId);
  // The sheet's code arrives on its first open and stays (`ItemSheet` above).
  const [sheetUsed, setSheetUsed] = useState(openItemId !== null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmUsed, setConfirmUsed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failures, setErrors] = useState<Readonly<Record<string, string>>>({});
  const marks = useUndoSends({
    url: MARK_DONE_URL,
    body: (id) => ({ id }),
    said: (title) => `Marked ${title} done`,
    notDone: "It was not marked done.",
    tooLate: "Undo came too late: it was marked done.",
    toastKey: "item-done",
  });
  const errors = { ...failures, ...marks.errors };
  // Marked done and waiting for the server's list: faded, its action gone (while still open).
  const waiting = (item: ItemView) => marks.held.has(item.id) && item.rules.markDone;
  const open = items.find((item) => item.id === openId) ?? null;
  const selectable = (item: ItemView) =>
    permissions.tick && (item.rules.markDone || item.rules.ticks);
  const chosen = items.filter((item) => selected.has(item.id) && !waiting(item));

  function openSheet(id: string) {
    setSheetUsed(true);
    setOpenId(id);
  }

  function markDone(item: ItemView) {
    setSelected((current) => {
      if (!current.has(item.id)) return current;
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    marks.start(item.id, item.title);
  }

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

  async function move(itemId: string, direction: "up" | "down") {
    const index = items.findIndex((item) => item.id === itemId);
    const position = movedPosition(items, index, direction);
    if (position === null) return;
    toastResult(await updateItem({ itemId, position }));
  }

  const openSelected = chosen.filter((item) => item.rules.markDone);
  const tickable = chosen.filter((item) => item.rules.ticks);
  // "Tick ‹stage› on N": the names the selected items carry (amendment D2).
  const choices = stageChoices(tickable);

  return (
    <section aria-labelledby="cycle-items-title" className="flex flex-col gap-2">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 id="cycle-items-title" className="text-sm font-medium">
          Items
        </h2>
        {canAdd && permissions.manage ? (
          <Button variant="secondary" data-slot="add-item" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            Add item
          </Button>
        ) : null}
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
            const ticked = item.stages.filter((stage) => stage.done).length;
            const action = permissions.tick && item.rules.markDone;
            return (
              <li
                key={item.id}
                data-slot="item-row"
                data-state={item.state}
                data-held={waiting(item) ? "" : undefined}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition-opacity sm:px-4",
                  waiting(item) && "opacity-50",
                )}
              >
                {selectable(item) ? (
                  // A 44 px target around the box (§14.1).
                  <label className="-ml-2 flex size-11 shrink-0 cursor-pointer items-center justify-center">
                    <Checkbox
                      aria-label={`Select ${item.title}`}
                      checked={selected.has(item.id)}
                      disabled={waiting(item)}
                      onCheckedChange={() => toggle(item.id)}
                    />
                  </label>
                ) : (
                  <span aria-hidden className="-ml-2 size-11 shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => openSheet(item.id)}
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
                    {item.stages.length > 0 ? (
                      <span className="md:hidden">
                        Stages {ticked}/{item.stages.length}
                      </span>
                    ) : null}
                  </span>
                  {item.sentBack ? (
                    <span className="text-xs break-words" data-slot="item-row-sent-back">
                      {item.sentBack.verb}: {item.sentBack.reason}
                    </span>
                  ) : null}
                </button>
                {item.stages.length > 0 ? (
                  <span className="hidden flex-wrap gap-1 md:flex" aria-label="Stages">
                    {item.stages.map((stage) => (
                      <span
                        key={stage.id}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                          stage.done
                            ? "border-primary/40 bg-primary/10"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {stage.done ? <CheckIcon className="size-3" aria-hidden /> : null}
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
                    disabled={waiting(item)}
                    data-slot="item-row-done"
                    onClick={() => markDone(item)}
                  >
                    Mark done
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
          // A trigger that opens a confirmation: neutral solid; the red commit names it (§14.1).
          <Button
            variant="strong"
            size="sm"
            pending={busy === "bulk-done"}
            pendingLabel="Marking done…"
            data-slot="bulk-mark-done"
            onClick={() => {
              setConfirmUsed(true);
              setConfirming(true);
            }}
          >
            Mark {openSelected.length} done
          </Button>
        ) : null}
        {permissions.tick && choices.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" data-slot="bulk-tick">
                Tick a stage
                <ChevronDownIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {choices.map((choice) => (
                <DropdownMenuItem
                  key={choice.name}
                  onSelect={() =>
                    void bulk(
                      "bulk-tick",
                      () => tickStages({ stageIds: choice.stageIds }),
                      `ticked ${choice.name}`,
                    )
                  }
                >
                  Tick {choice.name} on {choice.stageIds.length}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </BulkBar>
      {confirmUsed ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={(next) => (next ? null : setConfirming(false))}
          title={`Mark ${itemCount(openSelected.length)} done?`}
          description="Each counts as done at once and its stages lock; a done item is sent back or reopened with a reason. Each is its own change: one that fails keeps its message."
          confirmLabel={`Mark ${itemCount(openSelected.length)} done`}
          onConfirm={() =>
            bulk(
              "bulk-done",
              () => markItemsDone({ itemIds: openSelected.map((item) => item.id) }),
              "marked done",
            )
          }
        />
      ) : null}
      {adding ? <AddItemDialog cycleId={cycleId} onClose={() => setAdding(false)} /> : null}
      {sheetUsed ? (
        <ItemSheet
          item={open}
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
          onMarkDone={markDone}
        />
      ) : null}
    </section>
  );
}
