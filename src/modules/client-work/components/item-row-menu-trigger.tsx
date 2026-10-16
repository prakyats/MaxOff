"use client";

import { MoreHorizontalIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/primitives/button";

/**
 * A deliverable row's ⋯ button ("More: Open, Mark done"), drawn the same by the menu (as Radix's
 * trigger, `item-row-menu.tsx`) and by its stand-in until the menu's code has arrived
 * (`DeliverableRow`; ARCHITECTURE §19, the pattern of `ThemeMenuTrigger`).
 */
export function ItemRowMenuTrigger({
  title,
  className,
  ...props
}: ComponentProps<typeof Button> & { title: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`More for ${title}`}
      title="More: Open, Mark done"
      className={cn("size-11 lg:size-7", className)}
      {...props}
      // After the spread: Radix's trigger passes its own `data-slot`, and this one is the button's.
      data-slot="item-row-more"
    >
      <MoreHorizontalIcon aria-hidden />
    </Button>
  );
}
