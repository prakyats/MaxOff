"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ListIcon,
  PencilIcon,
} from "lucide-react";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors";
import { cn } from "@/core/lib/utils";
import type { ListKey } from "@/core/lists";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { FormField } from "@/core/ui/composites/form-field";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import { toastResult } from "@/core/ui/toast";

import { addListItem, moveListItemBy, renameListItem, setListItemArchived } from "../actions/lists";
import { FormError } from "./form-error";
import { ListItemActionsSheet } from "./list-item-actions-sheet";
import { RenameListItemDialog } from "./rename-list-item-dialog";

export type ManagedListItem = {
  id: string;
  name: string;
  archivedAt: string | null;
};

/**
 * One screen for any editable list (ADR-0002): add, rename, reorder and archive. Job titles
 * are the first (1.3 seeded them); task types (4.1) and stage presets (7.4) reuse it by adding
 * a key to `core/lists`' registry and a page. Order is changed one step at a time, which a
 * phone and a keyboard both handle; entries are archived, never deleted, so a member who
 * carries one keeps it.
 */
export function ListManager({
  listKey,
  labels,
  items,
}: {
  listKey: ListKey;
  labels: { singular: string; plural: string };
  items: ManagedListItem[];
}) {
  const [renaming, setRenaming] = useState<ManagedListItem | null>(null);
  const [archiving, setArchiving] = useState<ManagedListItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState(
    async (_previous: Result<null> | null, formData: FormData) => {
      const result = await addListItem({
        listKey,
        item: { name: String(formData.get("name") ?? "") },
      });
      if (result.ok) toast.success(`${labels.singular} added`);
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : null;

  const active = items.filter((item) => !item.archivedAt);
  const archived = items.filter((item) => item.archivedAt);

  async function move(item: ManagedListItem, direction: "up" | "down"): Promise<void> {
    setBusyId(item.id);
    toastResult(await moveListItemBy({ listKey, id: item.id, direction }));
    setBusyId(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        action={formAction}
        noValidate
        className="border-border flex flex-col gap-4 rounded-lg border p-4"
      >
        <FormError error={error} />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <FormField
            label={`Add a ${labels.singular.toLowerCase()}`}
            error={error?.fieldErrors?.["item.name"]}
            className="flex-1"
          >
            {(control) => (
              <Input
                {...control}
                name="name"
                // The component serves every list, so the hint comes from the list, not from
                // one example of a job title (ADR-0002: code knows keys, never entries).
                placeholder={`New ${labels.singular.toLowerCase()}`}
                maxLength={80}
                required
              />
            )}
          </FormField>
          <Button type="submit" disabled={pending} className="w-full sm:mt-6 sm:w-auto">
            {pending ? "Adding…" : "Add"}
          </Button>
        </div>
      </form>

      {active.length === 0 ? (
        <EmptyState
          icon={ListIcon}
          title={`No ${labels.plural.toLowerCase()} yet`}
          description={`Add the first one above. ${labels.plural} appear wherever people pick one.`}
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
              {/*
                Four 44px targets and a name do not fit side by side at 375px, so on a phone the
                row keeps only the two that are used while looking at the order (up and down) and
                moves Rename and Archive into a sheet behind one button (ARCHITECTURE §14.1:
                nothing hover-only, nothing clipped). Desktop shows all four.
              */}
              <div className={cn("flex items-center", CARD_ROW_TRAILING)}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${item.name} up`}
                  disabled={index === 0 || busyId !== null}
                  onClick={() => void move(item, "up")}
                >
                  <ChevronUpIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${item.name} down`}
                  disabled={index === active.length - 1 || busyId !== null}
                  onClick={() => void move(item, "down")}
                >
                  <ChevronDownIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Rename ${item.name}`}
                  onClick={() => setRenaming(item)}
                  className="hidden md:inline-flex"
                >
                  <PencilIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Archive ${item.name}`}
                  onClick={() => setArchiving(item)}
                  className="hidden md:inline-flex"
                >
                  <ArchiveIcon aria-hidden />
                </Button>
                <ListItemActionsSheet
                  item={item}
                  label={labels.singular}
                  onRename={() => setRenaming(item)}
                  onArchive={() => setArchiving(item)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

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

      {renaming ? (
        <RenameListItemDialog
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
          confirmLabel="Archive"
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
