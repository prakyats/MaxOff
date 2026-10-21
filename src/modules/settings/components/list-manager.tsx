"use client";

import { ArchiveRestoreIcon, ListIcon } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/core/lib/utils";
import type { ListKey } from "@/core/lists";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ListAddButton, ListHeading, ListRowActions } from "@/core/ui/composites/list-rows";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Button } from "@/core/ui/primitives/button";
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
 * row's ⋯ sheet) and a keyboard both handle; entries are archived, never deleted, so a member who
 * carries one keeps it.
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
  const archived = items.filter((item) => item.archivedAt);
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

      {archived.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-sm font-medium">Archived</h2>
          <p className="text-muted-foreground text-sm">
            Archived {labels.plural.toLowerCase()} are not offered any more. Anyone who already
            carries one keeps it.
          </p>
          <ul
            data-slot="archived-list-items"
            className="border-border divide-border divide-y rounded-lg border"
          >
            {archived.map((item) => (
              <li
                key={item.id}
                data-slot="archived-list-item"
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                <span className={cn("text-muted-foreground truncate text-sm", CARD_ROW_TITLE)}>
                  {item.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={CARD_ROW_TRAILING}
                  disabled={busyId !== null}
                  onClick={async () => {
                    setBusyId(item.id);
                    toastResult(
                      await setListItemArchived({ listKey, id: item.id, archived: false }),
                      {
                        success: `${labels.singular} restored`,
                      },
                    );
                    setBusyId(null);
                  }}
                >
                  <ArchiveRestoreIcon aria-hidden />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
          description={`It stops being offered. People who already have this ${labels.singular.toLowerCase()} keep it, and you can restore it later.`}
          confirmLabel={`Archive ${archiving.name}`}
          onConfirm={async () => {
            toastResult(await setListItemArchived({ listKey, id: archiving.id, archived: true }), {
              success: `${labels.singular} archived`,
            });
            setArchiving(null);
          }}
        />
      ) : null}
    </div>
  );
}
