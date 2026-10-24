"use client";

import { ListPlusIcon, PlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";

import { bulkSummary } from "@/core/errors/bulk";
import { cn } from "@/core/lib/utils";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { replaceViewAddress } from "@/core/ui/navigation/view-address";
import { Button } from "@/core/ui/primitives/button";
import type { StagePresetOption } from "@/core/ui/stage-groups/editing";
import { toastResult } from "@/core/ui/toast";

import { markItemsDone, tickStages, updateItem } from "../actions/items";
import { itemCount, stageChoices } from "../domain/items";
import { readyToMarkDone, solidMarkDoneId } from "../domain/deliverable";
import { movedPosition } from "../domain/positions";
import { orderDeliverables, type ItemView } from "../domain/views";

import type { BulkEditKind } from "./bulk-edit-sheet";
import { deliverableColumns } from "./deliverable-columns";
import { DeliverableRow } from "./deliverable-row";
import { FinishedDeliverables } from "./finished-deliverables";
import type { ItemPermissions } from "./item-sheet";
import { SelectToggle, useSelectMode } from "./select-mode";
import { tickWithUndo } from "./tick-with-undo";
import { MARK_DONE_URL, useUndoSends } from "./use-undo-sends";

/**
 * What draws nothing until it is used loads after the page (ARCHITECTURE §19, the 7B review's
 * S2): the item sheet and the bulk Mark done's confirmation are mounted on their first open and
 * kept (their closing stays animated); Add item is mounted while open. Select mode's action bar
 * (its Tick and Edit menus) is mounted when Select is first tapped and kept: it draws nothing
 * until a row is selected, and the selection lives here, so no tap waits for its code.
 */
const BulkEditBar = dynamic(() => import("./bulk-edit-bar").then((module) => module.BulkEditBar), {
  ssr: false,
});
const ItemSheet = dynamic(() => import("./item-sheet").then((module) => module.ItemSheet), {
  ssr: false,
});
const AddItemDialog = dynamic(
  () => import("./add-item-dialog").then((module) => module.AddItemDialog),
  { ssr: false },
);
const BulkEditSheet = dynamic(
  () => import("./bulk-edit-sheet").then((module) => module.BulkEditSheet),
  { ssr: false },
);
const GroupStagesDialog = dynamic(
  () => import("./group-stages-dialog").then((module) => module.GroupStagesDialog),
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
 * 6-second Undo (Today's own delayed send); the sheet's Mark done too. A tap anywhere on a row
 * opens the item sheet; its stage chips and "Next: ‹stage›" tick in one tap with an Undo toast
 * (unit U, `tickWithUndo`). **Select** (6b.16 (e)) turns on Select mode (`useSelectMode`: view state, back
 * leaves it; the checkboxes show only then); the selected rows' bar (`BulkEditBar`) offers the
 * bulk "Mark N done" (it asks first, its red button naming it, "Mark 5 items done") and "Tick
 * ‹stage› on N" for the selected items that have a stage of that name (decision 16: per-id
 * results, a failed row keeps its message), and for `projects.manage` "Edit N" on the open ones:
 * set or move planned dates, add a stage group, rename by a pattern (`BulkEditSheet`, one call
 * each, all or nothing). "Add item" adds to this
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
  solidAllowed = true,
}: {
  /**
   * The screen may carry a solid Mark done (E+): false while another solid control shows on
   * the same layer (the month-end "Keep extras" card's neutral solid Yes; §14.1).
   */
  solidAllowed?: boolean;
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
  const mode = useSelectMode();
  const { selected, setSelected } = mode;
  const [editing, setEditing] = useState<BulkEditKind | null>(null);
  const [editUsed, setEditUsed] = useState(false);
  // The Select bar's code arrives on the first Select and stays (`BulkEditBar` above).
  const [barUsed, setBarUsed] = useState(false);
  if (mode.selectMode && !barUsed) setBarUsed(true);
  const [openId, setOpenId] = useState<string | null>(openItemId);
  // The sheet's code arrives on its first open and stays (`ItemSheet` above).
  const [sheetUsed, setSheetUsed] = useState(openItemId !== null);
  const [adding, setAdding] = useState(false);
  // "Group stages" (fix D): the deliverable being split, mounted while open.
  const [grouping, setGrouping] = useState<ItemView | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmUsed, setConfirmUsed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // The row tick on its way (unit U): its stage's control waits.
  const [ticking, setTicking] = useState<string | null>(null);
  // The Select bar's height: reserved under the list while selecting, so the last row can scroll
  // clear of the floating bar (unit U).
  const [barHeight, setBarHeight] = useState(0);
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
    (permissions.tick && (item.rules.markDone || item.rules.ticks)) ||
    (permissions.manage && item.state === "open");
  const chosen = items.filter((item) => selected.has(item.id) && !waiting(item));

  function openSheet(id: string) {
    setSheetUsed(true);
    setOpenId(id);
  }

  function markDone(item: ItemView) {
    if (selected.has(item.id)) {
      const next = new Set(selected);
      next.delete(item.id);
      setSelected(next);
    }
    marks.start(item.id, item.title);
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
    toastResult(await updateItem({ itemId, position }), {
      success: `Moved ${items[index]?.title ?? "it"} ${direction}`,
    });
  }

  // 6b.11 (1): the open ones first (overdue at the top, then by date), the rest collapsed.
  const { open, finished } = orderDeliverables(items);
  // E+: Mark done is quiet until every stage is ticked; the first such row's is the screen's one
  // solid commit (never in Select mode, whose bar does it), the others outlined.
  const canMark = (item: ItemView) => permissions.tick && item.rules.markDone && !waiting(item);
  const solidId = solidMarkDoneId(open, canMark, solidAllowed && !mode.selectMode);
  const row = (item: ItemView) => (
    <DeliverableRow
      key={item.id}
      item={item}
      selecting={mode.selectMode}
      selectable={selectable(item)}
      selected={selected.has(item.id)}
      onToggle={() => mode.onToggle(item.id)}
      waiting={waiting(item)}
      action={permissions.tick && item.rules.markDone}
      look={item.id === solidId ? "solid" : readyToMarkDone(item) ? "ready" : "quiet"}
      ticks={{
        // Read-only in Select mode: a tap there selects, and the bar ticks a stage on N.
        can: permissions.tick && item.rules.ticks && !waiting(item) && !mode.selectMode,
        pending: ticking,
        tick: (stage, done) => void tickWithUndo(stage, done, item.title, setTicking),
      }}
      onOpen={() => openSheet(item.id)}
      onMarkDone={() => markDone(item)}
      error={errors[item.id]}
      manage={permissions.manage && !mode.selectMode}
      onGroup={permissions.manage ? () => setGrouping(item) : undefined}
    />
  );

  const openSelected = permissions.tick ? chosen.filter((item) => item.rules.markDone) : [];
  const tickable = permissions.tick ? chosen.filter((item) => item.rules.ticks) : [];
  // "Tick ‹stage› on N": the names the selected items carry (amendment D2).
  const choices = stageChoices(tickable);
  // The bulk edits take the open ones, in the list's order (6b.16 (e): "Reel {n}" numbers so).
  const editable = permissions.manage
    ? open.filter((item) => selected.has(item.id) && item.state === "open" && !waiting(item))
    : [];
  const selectableIds = items.filter(selectable).map((item) => item.id);

  return (
    <section aria-labelledby="cycle-items-title" className="flex flex-col gap-2">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 id="cycle-items-title" className="text-sm font-medium">
          Deliverables
        </h2>
        <span className="flex flex-wrap items-center gap-1">
          {items.length > 0 && (permissions.tick || permissions.manage) ? (
            <SelectToggle mode={mode} selectableIds={selectableIds} />
          ) : null}
          {canAdd && permissions.manage && !mode.selectMode && items.length > 0 ? (
            <Button variant="secondary" data-slot="add-item" onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden />
              Add deliverable
            </Button>
          ) : null}
        </span>
      </div>
      {mode.selectMode && chosen.length === 0 ? (
        <p data-slot="select-hint" className="text-muted-foreground text-sm">
          Select deliverables, then choose an action.
        </p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          icon={ListPlusIcon}
          size="compact"
          title={
            canAdd && permissions.manage
              ? "No deliverables yet: add one or start from a template."
              : "No deliverables in this cycle."
          }
          action={
            canAdd && permissions.manage ? (
              <Button variant="secondary" data-slot="add-item" onClick={() => setAdding(true)}>
                <PlusIcon aria-hidden />
                Add deliverable
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {open.length > 0 ? (
            <ul
              aria-label="Deliverables"
              data-slot="cycle-items"
              className={cn(
                "border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border",
                deliverableColumns(mode.selectMode),
              )}
            >
              <DeliverableHeader selecting={mode.selectMode} />
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
          <FinishedDeliverables count={finished.length} selecting={mode.selectMode}>
            {finished.map(row)}
          </FinishedDeliverables>
        </>
      )}
      {barUsed ? (
        <BulkEditBar
          count={chosen.length}
          onClear={() => setSelected(new Set())}
          markable={openSelected.length}
          marking={busy === "bulk-done"}
          onMarkDone={() => {
            setConfirmUsed(true);
            setConfirming(true);
          }}
          choices={choices}
          onTick={(choice) =>
            void bulk(
              "bulk-tick",
              () => tickStages({ stageIds: choice.stageIds }),
              `ticked ${choice.name}`,
            )
          }
          editable={editable.length}
          onEdit={(kind) => {
            setEditUsed(true);
            setEditing(kind);
          }}
          onHeight={setBarHeight}
        />
      ) : null}
      {mode.selectMode ? (
        // In flow under the list, only in Select mode: the bar's height plus its 12 px gap, or a
        // bar's usual height before one shows (no shift outside Select mode).
        <div
          aria-hidden
          data-slot="select-bar-space"
          className="h-16 shrink-0"
          style={barHeight > 0 ? { height: barHeight + 12 } : undefined}
        />
      ) : null}
      {editUsed ? (
        <BulkEditSheet
          kind={editing}
          items={editable.map((item) => ({ id: item.id, title: item.title }))}
          presets={presets}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {confirmUsed ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={(next) => (next ? null : setConfirming(false))}
          title={`Mark ${itemCount(openSelected.length)} done?`}
          description="Each counts as done at once and its stages lock; a done item is sent back or reopened with a reason. Each is its own change: one that fails keeps its message."
          confirmLabel={`Mark ${itemCount(openSelected.length)} done`}
          approve
          onConfirm={() =>
            bulk(
              "bulk-done",
              () => markItemsDone({ itemIds: openSelected.map((item) => item.id) }),
              "marked done",
            )
          }
        />
      ) : null}
      {grouping ? (
        <GroupStagesDialog
          target={{
            itemId: grouping.id,
            title: grouping.title,
            stages: grouping.stages.map((stage) => ({ id: stage.id, name: stage.name })),
          }}
          onClose={() => setGrouping(null)}
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
          canMove={(id, direction) =>
            movedPosition(
              items,
              items.findIndex((item) => item.id === id),
              direction,
            ) !== null
          }
          onMarkDone={markDone}
          presets={presets}
        />
      ) : null}
    </section>
  );
}

/**
 * The laptop table's header row (owner 2026-10-21, the approved sample): Deliverable · Progress by
 * group · Next · Planned, over the rows' columns (a subgrid). Hidden from assistive tech: each row
 * already names its parts; a phone has cards and no header.
 */
function DeliverableHeader({ selecting }: { selecting: boolean }) {
  return (
    <li
      aria-hidden
      data-slot="deliverables-header"
      className="bg-muted/40 text-muted-foreground hidden px-3 py-2 text-xs font-medium sm:px-4 lg:col-span-full lg:grid lg:grid-cols-subgrid"
    >
      {selecting ? <span /> : null}
      <span>Deliverable</span>
      <span>Progress by group</span>
      <span>Next</span>
      <span>Planned</span>
      <span />
    </li>
  );
}
