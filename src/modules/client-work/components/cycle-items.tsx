"use client";

import { ChevronDownIcon, ListPlusIcon, PlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";

import { bulkSummary } from "@/core/errors/bulk";
import { cn } from "@/core/lib/utils";
import { BulkBar } from "@/core/ui/composites/bulk-bar";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { replaceViewAddress } from "@/core/ui/navigation/view-address";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import type { StagePresetOption } from "@/core/ui/stage-groups/editing";
import { toastResult } from "@/core/ui/toast";

import { markItemsDone, tickStages, updateItem } from "../actions/items";
import { itemCount, stageChoices } from "../domain/items";
import { movedPosition } from "../domain/positions";
import { orderDeliverables, type ItemView } from "../domain/views";

import { DELIVERABLE_COLUMNS } from "./deliverable-columns";
import { DeliverableRow } from "./deliverable-row";
import { FinishedDeliverables } from "./finished-deliverables";
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
 * kickoff 7 decisions 16, 26; amendment D; 6b.11). **First glance:** the open deliverables first
 * (overdue at the top, then by planned date; `orderDeliverables`), each drawn by `DeliverableRow`
 * (its planned date, "Carried from …", the send-back note, its stage chips in their own column on
 * a laptop and in miniature on a phone, and one quiet action: **Mark done** while open, for whoever
 * ticks); done, closed and carried ones in the collapsed "Done and closed (N)" group
 * (`FinishedDeliverables`). Done
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
  defaultStages = 0,
  presets = [],
  openItemId = null,
}: {
  /** The stage presets, for a deliverable's Edit stages (6b). */
  presets?: readonly StagePresetOption[];
  /** How many default stages a new deliverable starts with (the Add dialog says so). */
  defaultStages?: number;
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
  const opened = items.find((item) => item.id === openId) ?? null;
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

  // 6b.11 (1): the open ones first (overdue at the top, then by date), the rest collapsed.
  const { open, finished } = orderDeliverables(items);
  const row = (item: ItemView) => (
    <DeliverableRow
      key={item.id}
      item={item}
      selectable={selectable(item)}
      selected={selected.has(item.id)}
      onToggle={() => toggle(item.id)}
      waiting={waiting(item)}
      action={permissions.tick && item.rules.markDone}
      onOpen={() => openSheet(item.id)}
      onMarkDone={() => markDone(item)}
      error={errors[item.id]}
    />
  );

  const openSelected = chosen.filter((item) => item.rules.markDone);
  const tickable = chosen.filter((item) => item.rules.ticks);
  // "Tick ‹stage› on N": the names the selected items carry (amendment D2).
  const choices = stageChoices(tickable);

  return (
    <section aria-labelledby="cycle-items-title" className="flex flex-col gap-2">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 id="cycle-items-title" className="text-sm font-medium">
          Deliverables
        </h2>
        {canAdd && permissions.manage ? (
          <Button variant="secondary" data-slot="add-item" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            Add deliverable
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={ListPlusIcon}
          size="compact"
          title="No deliverables in this cycle."
          description={
            canAdd && permissions.manage ? "Add deliverables to see their stages." : undefined
          }
        />
      ) : (
        <>
          {open.length > 0 ? (
            <ul
              aria-label="Deliverables"
              data-slot="cycle-items"
              className={cn(
                "border-border divide-border bg-card divide-y overflow-hidden rounded-lg border",
                DELIVERABLE_COLUMNS,
              )}
            >
              {open.map(row)}
            </ul>
          ) : (
            <p
              data-slot="cycle-items-all-finished"
              className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-3 text-sm"
            >
              Nothing open: every deliverable is done or closed.
            </p>
          )}
          <FinishedDeliverables count={finished.length}>{finished.map(row)}</FinishedDeliverables>
        </>
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
                  key={choice.key}
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
      {adding ? (
        <AddItemDialog
          cycleId={cycleId}
          defaultStages={defaultStages}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {sheetUsed ? (
        <ItemSheet
          item={opened}
          permissions={permissions}
          open={opened !== null}
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
          presets={presets}
        />
      ) : null}
    </section>
  );
}
