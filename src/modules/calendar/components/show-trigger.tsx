"use client";

import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/core/lib/utils";

import { type CalendarShow, SHOW_LABELS, SHOW_SHORT_LABELS } from "../domain/show";

/**
 * The `All ▾` button (v1.8, owner 23 Oct: the laptop toolbar, and the phone header's option A):
 * drawn the same by the menu (as Radix's trigger, which passes its own props and ref through) and
 * by its stand-in until the menu's code has arrived (`ShowControl`), so nothing moves when it does.
 * The current choice is its label; anything but All reads in a subtle neutral selected state (never
 * red), like Filters with a count. It holds both wordings: inside the phone header marked
 * `data-fit="short"` (`usePhoneHeaderFit`) it says "Client ▾", never an ellipsis.
 */
export function ShowTrigger({
  show,
  className,
  ...props
}: { show: CalendarShow } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={`Show: ${SHOW_LABELS[show]}`}
      className={cn(
        "pressable focus-visible:ring-ring border-control-border hover:bg-muted flex min-h-8 shrink-0 items-center gap-1 rounded-lg border pr-2 pl-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2",
        show !== "all" && "border-foreground bg-muted",
        className,
      )}
      {...props}
      // After the props: Radix's trigger passes its own `data-slot`.
      data-slot="calendar-show-menu"
      data-current={show}
    >
      <span
        data-show-word="long"
        className="group-data-[fit=short]/header:hidden group-data-[fit=snug]/header:hidden group-data-[fit=tight]/header:hidden"
      >
        {SHOW_LABELS[show]}
      </span>
      <span
        data-show-word="short"
        className="hidden group-data-[fit=short]/header:inline group-data-[fit=snug]/header:inline group-data-[fit=tight]/header:inline"
      >
        {SHOW_SHORT_LABELS[show]}
      </span>
      <ChevronDownIcon className="text-muted-foreground size-4" aria-hidden />
    </button>
  );
}
