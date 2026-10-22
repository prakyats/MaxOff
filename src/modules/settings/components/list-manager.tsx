"use client";

import { ListIcon } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/core/lib/utils";
import type { ListKey } from "@/core/lists";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ListAddButton, ListHeading, ListRowActions } from "@/core/ui/composites/list-rows";
import { CARD_ROW_TITLE } from "@/core/ui/composites/row-metrics";
import { toastResult } from "@/core/ui/toast";

import { addListItem, moveListItemBy, renameListItem, setListItemArchived } from "../actions/lists";
import { ListItemDialog } from "./list-item-dialog";

export type ManagedListItem = {
  id: string;
  name: string;
  archivedAt: string | null;
};

/**
 * One screen for any editable list (ADR-0002): add, rename, reorder and archive. Job titles
 * are the first (1.3 seeded them); expense categories reuse it by adding a key to `core/lists`'
 * registry and a page. Adding follows the Settings Add pattern (C4): "Add ‹thing›" on the list's
 * heading opens a one-field dialog. Order is changed one step at a time, which a phone (in the
 * row's ⋯ sheet) and a keyboard both handle. Archive (D6; named Archive again, owner 2026-10-21): a member
 * who carries one keeps it; Undo in its toast brings it back, and no Archived list is shown.
 */
export function ListManager({
  listKey,
  labels,
  items,
  title,
  headingId,
}: {
  listKey: ListKey;
  labels: { singular: string; plural: string };
  items: ManagedListItem[];
  /** The list's heading ("Categories"); the count of active entries ("7 job titles") by default. */
  title?: string;
  headingId?: string;
}) {
  const ownId = useId();
  const listId = headingId ?? ownId;
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<ManagedListItem | null>(null);
  const [archiving, setArchiving] = useState<ManagedListItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const active = items.filter((item) => !item.archivedAt);
  const thing = labels.singular.toLowerCase();

  async function move(item: ManagedListItem, direction: "up" | "down"): Promise<void> {
    setBusyId(item.id);
    toastResult(await moveListItemBy({ listKey, id: item.id, direction }));
    setBusyId(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={listId} className="flex flex-col gap-3">
        <ListHeading
          id={listId}
          title={
            title ?? `${active.length} ${active.length === 1 ? thing : labels.plural.toLowerCase()}`
          }
          action={
            <ListAddButton onClick={() => setAdding(true)} data-slot="list-add">
              Add {thing}
            </ListAddButton>
          }
        />

        {active.length === 0 ? (
          <EmptyState
            icon={ListIcon}
            title={`No ${labels.plural.toLowerCase()} yet`}
            description={`Add the first with "Add ${thing}". ${labels.plural} appear wherever people pick one.`}
          />
        ) : (
          <ul
            data-slot="list-items"
            className="border-border divide-border divide-y rounded-lg border"
          >
            {active.map((item, index) => (
              <li
                key={item.id}
                data-slot="list-item"
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                <span className={cn("truncate text-sm font-medium", CARD_ROW_TITLE)}>
                  {item.name}
                </span>
                <ListRowActions
                  name={item.name}
                  kind={labels.singular}
                  slot="list-item-actions"
                  move={{
                    onMove: (direction) => void move(item, direction),
                    first: index === 0,
                    last: index === active.length - 1,
                    disabled: busyId !== null,
                  }}
                  edit={{ label: "Rename", onSelect: () => setRenaming(item) }}
                  onArchive={() => setArchiving(item)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {adding ? (
        <ListItemDialog
          key="add"
          label={labels.singular}
          onClose={() => setAdding(false)}
          onSubmit={async (name) => addListItem({ listKey, item: { name } })}
        />
      ) : null}

      {renaming ? (
        <ListItemDialog
          key={renaming.id}
          label={labels.singular}
          name={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => renameListItem({ listKey, id: renaming.id, item: { name } })}
        />
      ) : null}

      {archiving ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setArchiving(null);
          }}
          title={`Archive ${archiving.name}?`}
          description={`It won't be offered again. People who already have this ${labels.singular.toLowerCase()} keep it.`}
          confirmLabel={`Archive ${archiving.name}`}
          onConfirm={async () => {
            const { id, name } = archiving;
            toastResult(await setListItemArchived({ listKey, id, archived: true }), {
              success: `${name} archived`,
              undo: () =>
                void setListItemArchived({ listKey, id, archived: false }).then((result) =>
                  toastResult(result),
                ),
            });
            setArchiving(null);
          }}
        />
      ) : null}
    </div>
  );
}
