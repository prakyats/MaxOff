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

import {
  approveItems,
  markItemDone,
  markItemsDone,
  tickStageOn,
  updateItem,
} from "../actions/items";
import { itemCount } from "../domain/items";
import { movedPosition } from "../domain/positions";
import { ITEM_STATUS } from "../domain/types";
import type { ItemView } from "../domain/views";

import type { ItemPermissions } from "./item-sheet";
import { APPROVE_URL, useUndoSends } from "./use-undo-sends";

/**
 * What draws nothing until it is used loads after the page (ARCHITECTURE §19, the 7B review's
 * S2): the item sheet and the bulk Approve's confirmation are mounted on their first open and
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
 * A cycle's items on the project page (7.3; PRODUCT §4.5, WORKFLOWS §5.4 items 6, 7, 9, 16, 18;
 * kickoff 7 decisions 16, 26). **First glance:** each item with its planned date (red once
 * overdue), "Carried from …", a "sent back" note, its stages ticked (from `md` up; the sheet holds
 * them on a phone) and one action: **Mark done** while open, **Approve** while done (for whoever
 * approves: instant with the 6-second Undo, as Approvals, because approving locks the item and
 * counts it for revenue; the sheet's Approve too). A tap on the title opens the item sheet.
 * Selecting rows offers the bulk "Mark N done", "Tick ‹stage› on N" and "Approve N" (decision 16:
 * per-id results, a failed row keeps its message); "Approve N" asks first, its red button naming
 * it ("Approve 5 items"). "Add item" adds to this cycle (never a past one, decision 9). Nothing is reordered
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
  // The sheet's code arrives on its first open and stays (`ItemSheet` above).
  const [sheetUsed, setSheetUsed] = useState(openItemId !== null);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<"approve" | null>(null);
  const [confirmUsed, setConfirmUsed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failures, setErrors] = useState<Readonly<Record<string, string>>>({});
  const approvals = useUndoSends({
    url: APPROVE_URL,
    body: (id) => ({ kind: "item", id }),
    said: (title) => `Approved ${title}`,
    notDone: "It was not approved.",
    tooLate: "Undo came too late: it was approved.",
    toastKey: "item-approve",
  });
  const errors = { ...failures, ...approvals.errors };
  // Approved and waiting for the server's list: faded, its action gone (while still done).
  const waiting = (item: ItemView) => approvals.held.has(item.id) && item.rules.decide;
  const open = items.find((item) => item.id === openId) ?? null;
  const selectable = (item: ItemView) =>
    (permissions.tick && (item.rules.markDone || item.rules.ticks)) ||
    (permissions.approve && item.rules.decide);
  const chosen = items.filter((item) => selected.has(item.id) && !waiting(item));

  function openSheet(id: string) {
    setSheetUsed(true);
    setOpenId(id);
  }

  function approve(item: ItemView) {
    setSelected((current) => {
      if (!current.has(item.id)) return current;
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    approvals.start(item.id, item.title);
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

  async function single(item: ItemView) {
    if (!item.rules.markDone) {
      approve(item);
      return;
    }
    setBusy(item.id);
    toastResult(await markItemDone({ itemId: item.id }), { success: "Marked done" });
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
                    disabled={waiting(item)}
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
          // A trigger that opens a confirmation: neutral solid; the red commit names it (§14.1).
          <Button
            variant="strong"
            size="sm"
            pending={busy === "bulk-approve"}
            pendingLabel="Approving…"
            data-slot="bulk-approve"
            onClick={() => {
              setConfirmUsed(true);
              setConfirming("approve");
            }}
          >
            Approve {doneSelected.length}
          </Button>
        ) : null}
      </BulkBar>
      {confirmUsed ? (
        <ConfirmDialog
          open={confirming === "approve"}
          onOpenChange={(next) => (next ? null : setConfirming(null))}
          title={`Approve ${itemCount(doneSelected.length)}?`}
          description="Each is locked once approved and counts as delivered. Each is its own approval: one that fails keeps its message."
          confirmLabel={`Approve ${itemCount(doneSelected.length)}`}
          onConfirm={() =>
            bulk(
              "bulk-approve",
              () => approveItems({ itemIds: doneSelected.map((item) => item.id) }),
              "approved",
            )
          }
        />
      ) : null}
      {adding ? <AddItemDialog cycleId={cycleId} onClose={() => setAdding(false)} /> : null}
      {sheetUsed ? (
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
          onApprove={approve}
        />
      ) : null}
    </section>
  );
}
