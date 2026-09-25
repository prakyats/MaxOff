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
 *
 * **Phone:** a surface of the card token (a form lives on a card or a sheet, never on the bare
 * page), a top border, and the side safe areas. **From `md` up:** not a bar at all, just the
 * form's last row: no background, no border, no padding, buttons right-aligned in their DOM
 * order (Cancel, then Save). Before 2.9's review it kept `bg-background` there, which drew a
 * page-coloured band across the card behind the buttons (owner's check, 2026-09-26).
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
        "border-border bg-card/95 supports-[backdrop-filter]:bg-card/85 fixed inset-x-0 bottom-[calc(var(--app-bottom-nav-h)+var(--app-safe-bottom))] z-30 flex gap-2 border-t py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur",
        "*:flex-1",
        "md:static md:justify-end md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none md:*:flex-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
