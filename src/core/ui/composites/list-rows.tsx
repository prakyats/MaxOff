"use client";

import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { cn } from "@/core/lib/utils";
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
 * (Move up / Move down keep the sheet open, as ReorderNameList's menu does). Archive is never red
 * (C3, owner 2026-10-16: "archive never red"); its question is the caller's `ConfirmDialog`.
 */
export function ListRowActions({
  name,
  kind,
  slot,
  move,
  edit,
  onArchive,
}: {
  /** The row's name, for the labels ("Archive Editor") and the sheet's title. */
  name: string;
  /** What the row is, for the sheet's description ("Job title actions"). */
  kind: string;
  /** The phone sheet's `data-slot`. */
  slot: string;
  move?: ListRowMove;
  edit?: { label: "Edit" | "Rename"; onSelect: () => void };
  onArchive?: () => void;
}) {
  const [open, setOpen] = useState(false);
  function choose(then: () => void) {
    setOpen(false);
    then();
  }
  return (
    <div className={cn("flex items-center", CARD_ROW_TRAILING)}>
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
          onClick={onArchive}
          className="hidden md:inline-flex"
        >
          <ArchiveIcon aria-hidden />
        </Button>
      ) : null}
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
                <ArchiveIcon aria-hidden />
                Archive
              </Button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
