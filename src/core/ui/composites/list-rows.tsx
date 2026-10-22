"use client";

import {
  EyeIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { cn } from "@/core/lib/utils";
import { ICONS } from "@/core/ui/icons";
import { Button } from "@/core/ui/primitives/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/core/ui/primitives/sheet";

import { CARD_ROW_TRAILING } from "./row-metrics";

const Archive = ICONS.archive;

/**
 * The one Add pattern for Settings lists (C4, docs/DESIGN.md §4 "The Add pattern"): a neutral
 * outline button with a plus, naming the thing ("Add job title"), at the right of the list's
 * heading row. It opens the add dialog (a bottom sheet on a phone), whose commit is the `primary`
 * "Add ‹thing›". Never a solid button, never a floating one, never an inline add form.
 */
export function ListAddButton({
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant">) {
  // At large system text a long name ("Add deliverable template") wraps inside the button
  // instead of pushing past a 375px screen's edge.
  return (
    <Button
      type="button"
      variant="secondary"
      className={cn(
        "h-auto min-h-8 max-w-full py-1 text-left whitespace-normal pointer-coarse:min-h-11",
        className,
      )}
      {...props}
    >
      <PlusIcon aria-hidden />
      {children}
    </Button>
  );
}

/** A list's heading row: its name on the left, its `ListAddButton` (if any) on the right. */
export function ListHeading({
  id,
  title,
  action,
  className,
}: {
  id?: string;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="list-heading"
      className={cn("flex min-h-11 flex-wrap items-center justify-between gap-x-3", className)}
    >
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      {action ? <div className="ml-auto max-w-full shrink-0">{action}</div> : null}
    </div>
  );
}

export type ListRowMove = {
  onMove: (direction: "up" | "down") => void;
  first: boolean;
  last: boolean;
  disabled?: boolean;
};

/**
 * A Settings row's actions (C3, C4, P2). **Laptop** (`md` up): grey icon buttons, Move up and
 * Move down (when the list has an order), Edit (or Rename) and Archive. **Phone**: one 44 px ⋯
 * that opens a bottom sheet with the same actions as full-width rows, so a 375 px row never packs
 * four targets beside a name (ARCHITECTURE §14.1), and moving stays possible with a thumb
 * (Move up / Move down keep the sheet open, as ReorderNameList's menu does). **The one Settings
 * list pattern is Edit · Archive** (D6, v1.8 V4; named Archive again with the archive box, owner
 * 2026-10-21, PP-templates-2): the row's icon is grey (C3); its question is the caller's
 * `ConfirmDialog`, whose named "Archive ‹name›" is the neutral `primary` (archive is never red), and
 * its toast offers Undo, and `ArchivedSection` (below) restores it later. A row that can be looked at (templates) also has Preview, a
 * labelled button at every width, since anyone who may open the list may preview.
 *
 * **Delete** (v1.8 V5a 6b, owner 2026-10-22) is the Owner's only, so a caller passes `onDelete` for
 * the Owner alone: the row keeps Edit · Archive · Delete. Delete is permanent, so it is red before
 * its confirmation too (`destructive`: a red outline icon on a laptop, a red outline row in the
 * phone sheet); the confirmation's named "Delete ‹name›" is the red `danger` commit.
 */
export function ListRowActions({
  name,
  kind,
  slot,
  move,
  edit,
  preview,
  onArchive,
  onRestore,
  onDelete,
}: {
  /** The row's name, for the labels ("Archive Editor") and the sheet's title. */
  name: string;
  /** What the row is, for the sheet's description ("Job title actions"). */
  kind: string;
  /** The phone sheet's `data-slot`. */
  slot: string;
  move?: ListRowMove;
  edit?: { label: "Edit" | "Rename"; onSelect: () => void } | undefined;
  /** Preview, with the button's tooltip ("See what a project started from … gets"). */
  preview?: { onSelect: () => void; title: string };
  onArchive?: (() => void) | undefined;
  /**
   * Restore, on an archived row (`ArchivedSection`, V5b-0 item 9): a labelled grey button at every
   * width, since it is the row's one everyday action there.
   */
  onRestore?: (() => void) | undefined;
  /** The Owner's permanent Delete (opens the caller's confirmation). */
  onDelete?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  function choose(then: () => void) {
    setOpen(false);
    then();
  }
  return (
    <div className={cn("flex items-center", CARD_ROW_TRAILING)}>
      {preview ? (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          aria-label={`Preview ${name}`}
          title={preview.title}
          onClick={preview.onSelect}
        >
          <EyeIcon aria-hidden />
          Preview
        </Button>
      ) : null}
      {onRestore ? (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          aria-label={`Restore ${name}`}
          onClick={onRestore}
          data-slot="list-row-restore"
        >
          <RotateCcwIcon aria-hidden />
          Restore
        </Button>
      ) : null}
      {move ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${name} up`}
            disabled={move.first || move.disabled}
            onClick={() => move.onMove("up")}
            className="hidden md:inline-flex"
          >
            <ChevronUpIcon aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${name} down`}
            disabled={move.last || move.disabled}
            onClick={() => move.onMove("down")}
            className="hidden md:inline-flex"
          >
            <ChevronDownIcon aria-hidden />
          </Button>
        </>
      ) : null}
      {edit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${edit.label} ${name}`}
          title={`${edit.label} ${name}`}
          onClick={edit.onSelect}
          className="hidden md:inline-flex"
        >
          <PencilIcon aria-hidden />
        </Button>
      ) : null}
      {onArchive ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Archive ${name}`}
          title={`Archive ${name}`}
          onClick={onArchive}
          className="hidden md:inline-flex"
        >
          <Archive aria-hidden />
        </Button>
      ) : null}
      {onDelete ? (
        // A quiet grey bin (owner, V5b preview): red belongs to the confirmation's commit only
        // (the colour rule); a 44 px target.
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Delete ${name}`}
          title={`Delete ${name}`}
          onClick={onDelete}
          className="text-muted-foreground ml-1 hidden size-11 md:inline-flex"
        >
          <Trash2Icon aria-hidden />
        </Button>
      ) : null}
      {move || edit || onArchive || onDelete ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${name}`}
              className="md:hidden"
            >
              <MoreHorizontalIcon aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            data-slot={slot}
            className="rounded-t-sheet gap-3 pb-[calc(1.5rem+var(--app-safe-bottom))]"
          >
            <div
              aria-hidden
              className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
            />
            <SheetHeader className="pt-3 pr-12 pb-0">
              <SheetTitle>{name}</SheetTitle>
              <SheetDescription className="sr-only">{kind} actions</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-2 px-4">
              {move ? (
                <>
                  <Button
                    variant="secondary"
                    className="w-full justify-start"
                    disabled={move.first || move.disabled}
                    onClick={() => move.onMove("up")}
                  >
                    <ChevronUpIcon aria-hidden />
                    Move up
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full justify-start"
                    disabled={move.last || move.disabled}
                    onClick={() => move.onMove("down")}
                  >
                    <ChevronDownIcon aria-hidden />
                    Move down
                  </Button>
                </>
              ) : null}
              {edit ? (
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => choose(edit.onSelect)}
                >
                  <PencilIcon aria-hidden />
                  {edit.label}
                </Button>
              ) : null}
              {onArchive ? (
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => choose(onArchive)}
                >
                  <Archive aria-hidden />
                  Archive
                </Button>
              ) : null}
              {onDelete ? (
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => choose(onDelete)}
                >
                  <Trash2Icon aria-hidden />
                  Delete
                </Button>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

/**
 * **The Archived section** (V5b-0 item 9, owner 2026-10-22: archived rows must not vanish with no
 * way back). At the foot of every list that has Archive: a collapsed "Archived (n)" (a native
 * `<details>`, a view control: opening it adds no history, §14.2 d), hidden when nothing is
 * archived. Its rows are `ArchivedRow`s: the name, muted, with Restore (whoever may archive the
 * row) and the Owner's Delete (through the list's own confirmation, which checks use first).
 */
export function ArchivedSection({
  count,
  children,
  slot = "archived-section",
}: {
  count: number;
  children: ReactNode;
  slot?: string;
}) {
  if (count <= 0) return null;
  return (
    <details data-slot={slot} className="group/archived">
      <summary
        data-slot="archived-toggle"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-sm font-medium outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden"
      >
        <ICONS.open
          aria-hidden
          className="size-4 shrink-0 transition-transform duration-200 group-open/archived:rotate-90 motion-reduce:transition-none"
        />
        Archived ({count})
      </summary>
      <ul
        data-slot="archived-items"
        className="border-border divide-border bg-card shadow-raised mt-2 divide-y rounded-lg border"
      >
        {children}
      </ul>
    </details>
  );
}

/** One archived row: its name (and a muted meta line), then Restore and the Owner's Delete. */
export function ArchivedRow({
  name,
  meta,
  kind,
  onRestore,
  onDelete,
}: {
  name: string;
  meta?: ReactNode;
  /** What the row is ("Job title"), for the phone sheet's description. */
  kind: string;
  onRestore?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}) {
  return (
    <li
      data-slot="archived-item"
      className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
    >
      <span className="flex min-w-0 flex-[1_1_6rem] flex-col gap-0.5">
        <span className="text-muted-foreground text-sm font-medium break-words">{name}</span>
        {meta ? <span className="text-muted-foreground text-xs break-words">{meta}</span> : null}
      </span>
      {onRestore || onDelete ? (
        <ListRowActions
          name={name}
          kind={kind}
          slot="archived-item-actions"
          onRestore={onRestore}
          onDelete={onDelete}
        />
      ) : null}
    </li>
  );
}
