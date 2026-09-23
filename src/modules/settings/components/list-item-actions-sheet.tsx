"use client";

import { ArchiveIcon, MoreHorizontalIcon, PencilIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/core/ui/primitives/sheet";

/**
 * Rename and Archive for one list entry, on a phone (task 1.5). A row that carried four 32px
 * icon buttons next to a name could not give any of them the 44px they need at 375px
 * (ARCHITECTURE §14.1), so the two that aren't about ordering move behind this one button.
 * Hidden from `md` up, where the row has space for all four.
 */
export function ListItemActionsSheet({
  item,
  label,
  onRename,
  onArchive,
}: {
  item: { name: string };
  /** The singular list label, e.g. "Job title". */
  label: string;
  onRename: () => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${item.name}`}
          className="md:hidden"
        >
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        data-slot="list-item-actions"
        className="gap-3 rounded-t-2xl pb-[calc(1.5rem+var(--app-safe-bottom))]"
      >
        <div
          aria-hidden
          className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
        />
        <SheetHeader className="pt-3 pr-12 pb-0">
          <SheetTitle>{item.name}</SheetTitle>
          <SheetDescription className="sr-only">{label} actions</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => choose(onRename)}
          >
            <PencilIcon aria-hidden />
            Rename
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => choose(onArchive)}
          >
            <ArchiveIcon aria-hidden />
            Archive
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
