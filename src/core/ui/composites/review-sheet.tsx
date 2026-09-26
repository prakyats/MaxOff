"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { cn } from "@/core/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/primitives/sheet";

const DESKTOP = "(min-width: 768px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * A record's "Review" sheet (PRODUCT "Approvals": everything that needs thought opens a sheet):
 * a bottom sheet on a phone, a side sheet from `md` up. It registers with the overlay history
 * like every `Sheet` (ARCHITECTURE §14.2 a). A dialog opened from its actions is held by the
 * caller **next to** this sheet, which stays open underneath, so back closes the dialog, then
 * the sheet, then the screen.
 */
export function ReviewSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  // Only read while open (a tap), so the server's "bottom" never paints over a desktop.
  const side = useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(DESKTOP).matches ? "right" : "bottom"),
    () => "bottom" as const,
  );
  const bottom = side === "bottom";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        data-slot="review-sheet"
        className={cn(
          "gap-4 overflow-y-auto",
          bottom && "max-h-[85dvh] rounded-t-2xl pb-[calc(1.5rem+var(--app-safe-bottom))]",
        )}
      >
        {bottom ? (
          <div
            aria-hidden
            className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
          />
        ) : null}
        <SheetHeader className={cn("pr-12", bottom && "pt-3 pb-0")}>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className={description ? undefined : "sr-only"}>
            {description ?? "Details and actions"}
          </SheetDescription>
        </SheetHeader>
        <div data-slot="review-sheet-body" className="px-4 text-sm">
          {children}
        </div>
        {actions ? (
          <div
            data-slot="review-sheet-actions"
            className="border-border flex flex-col gap-2 border-t px-4 pt-4 md:flex-row md:justify-end"
          >
            {actions}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** A label and its value, one per line, the way every review sheet lists facts. */
export function ReviewFacts({ facts }: { facts: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-col gap-3">
      {facts.map((fact) => (
        <div key={fact.label} className="flex justify-between gap-4">
          <dt className="text-muted-foreground shrink-0">{fact.label}</dt>
          <dd className="min-w-0 text-right break-words">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
