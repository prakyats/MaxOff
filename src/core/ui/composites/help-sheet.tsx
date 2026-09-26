"use client";

import { InfoIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/core/ui/primitives/sheet";

/**
 * Where a screen's explanatory paragraph goes on a phone (ARCHITECTURE §14.1: "Explanatory text
 * moves to the empty state or a help sheet"). A description that eats the first screenful is the
 * thing 1.5 set out to remove, but some of them genuinely answer a question — those get this
 * small "i" in the title bar instead of being deleted.
 *
 * Desktop keeps the paragraph under the title and hides this.
 */
export function HelpSheet({ title, children }: { title: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        data-slot="help-trigger"
        aria-label="About this screen"
        className="text-muted-foreground active:bg-muted flex size-11 shrink-0 items-center justify-center rounded-lg md:hidden"
      >
        <InfoIcon className="size-4" aria-hidden />
      </SheetTrigger>
      <SheetContent
        side="bottom"
        data-slot="help-sheet"
        className="max-h-[70dvh] gap-3 overflow-y-auto rounded-t-2xl pb-[calc(1.5rem+var(--app-safe-bottom))]"
      >
        <div
          aria-hidden
          className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
        />
        <SheetHeader className="pt-3 pb-0">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">What this screen is for</SheetDescription>
        </SheetHeader>
        <div className="text-muted-foreground px-4 text-sm">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
