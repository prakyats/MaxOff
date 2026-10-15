"use client";

import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { DropdownMenuItem } from "@/core/ui/primitives/dropdown-menu";

import type { Reorder } from "./use-reorder";

/**
 * The pieces of a reorderable list (ROADMAP 6b.18), driven by one `useReorder`: the list (with
 * its drop line and live region), a row, the row's 44 px drag handle, and the Move up / Move
 * down menu entries that stay as the keyboard and screen-reader way (WCAG 2.5.7).
 */
export function ReorderList({
  reorder,
  label,
  className,
  children,
  ...props
}: {
  reorder: Reorder;
  /** The list's accessible name. */
  label: string;
  className?: string;
  children: ReactNode;
} & Omit<React.ComponentProps<"ul">, "children">) {
  return (
    <>
      <ul
        aria-label={label}
        data-reordering={reorder.dragging !== null ? "" : undefined}
        className={cn("relative flex flex-col", className)}
        {...props}
      >
        {children}
        <li
          aria-hidden
          hidden
          data-reorder-indicator=""
          data-slot="reorder-indicator"
          className="bg-foreground pointer-events-none absolute inset-x-0 z-20 h-0.5 rounded-full"
        />
      </ul>
      <p className="sr-only" aria-live="polite" aria-atomic>
        {reorder.announcement}
      </p>
    </>
  );
}

/** A row: while it is dragged it rides above the others on the card's surface. */
export function ReorderItem({
  reorder,
  index,
  className,
  children,
  ...props
}: {
  reorder: Reorder;
  index: number;
  className?: string;
  children: ReactNode;
} & Omit<React.ComponentProps<"li">, "children">) {
  const dragging = reorder.dragging === index;
  return (
    <li
      data-reorder-item=""
      data-dragging={dragging ? "" : undefined}
      className={cn(
        "relative",
        dragging && "bg-popover ring-foreground/15 z-10 rounded-lg shadow-lg ring-1",
        className,
      )}
      {...props}
    >
      {children}
    </li>
  );
}

/**
 * The drag handle: a 44 × 44 target, `touch-action: none` so a long press on a phone can become a
 * drag. Hidden from assistive tech: Move up / Move down are its accessible equivalent.
 */
export function DragHandle({
  reorder,
  index,
  className,
}: {
  reorder: Reorder;
  index: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      title="Drag to reorder"
      className={cn(
        "text-muted-foreground flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg select-none active:cursor-grabbing",
        reorder.count < 2 && "invisible",
        className,
      )}
      {...reorder.handleProps(index)}
    >
      <GripVerticalIcon className="size-4" />
    </span>
  );
}

/** "Move up" and "Move down" for a row's ⋯ menu; each is disabled at its end of the list. */
export function ReorderMenuItems({ reorder, index }: { reorder: Reorder; index: number }) {
  return (
    <>
      <DropdownMenuItem disabled={index === 0} onSelect={() => reorder.move(index, index - 1)}>
        <ArrowUpIcon aria-hidden />
        Move up
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={index >= reorder.count - 1}
        onSelect={() => reorder.move(index, index + 1)}
      >
        <ArrowDownIcon aria-hidden />
        Move down
      </DropdownMenuItem>
    </>
  );
}
