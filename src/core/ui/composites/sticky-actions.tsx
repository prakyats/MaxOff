import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";

/**
 * A form's submit row: **a sticky bar at the bottom of the viewport on a phone**, above the
 * bottom bar and the home indicator, and an ordinary row in the flow on desktop
 * (ARCHITECTURE §14.1: "the primary action is reachable … never hidden behind the keyboard").
 *
 * A list screen's one action is a FAB instead — `PageHeader`'s `actions` handles that. Save is
 * a bar because it is wide, often paired with a Cancel, and belongs to the form, not the page.
 *
 * Like `page-actions` this is one element repositioned by CSS, not a mobile copy and a desktop
 * copy, so a form never submits from two buttons.
 */
export function StickyActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="sticky-actions"
      className={cn(
        "border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-[calc(var(--app-bottom-nav-h)+var(--app-safe-bottom))] z-30 flex gap-2 border-t px-4 py-3 backdrop-blur",
        "*:flex-1",
        "md:bg-background md:static md:border-0 md:px-0 md:py-0 md:backdrop-blur-none md:*:flex-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
