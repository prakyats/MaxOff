"use client";

import { useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/primitives/sheet";

import type { GuideShotImage } from "./guide-view";

/**
 * A guide screenshot, large (ROADMAP 6b.14, ADVISOR 15 Oct: "tap to enlarge in a sheet with
 * §14.2 back"). A bottom sheet, so the system back closes it before it leaves the guide; the
 * picture scrolls sideways on a phone at its own width when it is wider than the screen.
 */
export function ShotViewer({ shot, onClose }: { shot: GuideShotImage; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        data-slot="guide-shot-viewer"
        className="max-h-[92dvh] gap-3 overflow-y-auto rounded-t-2xl pb-[calc(1rem+var(--app-safe-bottom))]"
      >
        <SheetHeader className="pt-3 pb-0">
          <SheetTitle className="pr-10 text-base">{shot.alt}</SheetTitle>
          <SheetDescription className="sr-only">The screenshot, enlarged</SheetDescription>
        </SheetHeader>
        <div className="overflow-x-auto px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shot.src}
            alt={shot.alt}
            width={shot.width}
            height={shot.height}
            className="border-border block h-auto max-w-none rounded-md border md:w-full md:max-w-full"
            style={{ width: `max(100%, ${Math.min(shot.width, 900)}px)` }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
