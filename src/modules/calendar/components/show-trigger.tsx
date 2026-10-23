"use client";

import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/core/lib/utils";

import { type CalendarShow, SHOW_LABELS } from "../domain/show";

/**
 * The laptop's `All ▾` button (v1.8 calendar toolbar, owner 23 Oct): drawn the same by the menu
 * (as Radix's trigger, which passes its own props and ref through) and by its stand-in until the
 * menu's code has arrived (`ShowControl`), so nothing moves when it does. The current choice is
 * its label; anything but All reads in a subtle neutral selected state (never red), like Filters
 * with a count.
 */
export function ShowTrigger({
  show,
  className,
  ...props
}: { show: CalendarShow } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="calendar-show-menu"
      data-current={show}
      aria-label={`Show: ${SHOW_LABELS[show]}`}
      className={cn(
        "pressable focus-visible:ring-ring border-control-border hover:bg-muted flex min-h-8 shrink-0 items-center gap-1 rounded-lg border pr-2 pl-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2",
        show !== "all" && "border-foreground bg-muted",
        className,
      )}
      {...props}
    >
      {SHOW_LABELS[show]}
      <ChevronDownIcon className="text-muted-foreground size-4" aria-hidden />
    </button>
  );
}
