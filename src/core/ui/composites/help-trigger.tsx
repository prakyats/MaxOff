"use client";

import { InfoIcon } from "lucide-react";
import type { ComponentProps } from "react";

/**
 * The help sheet's "i" in the title bar, drawn the same by the sheet (as Radix's trigger, which
 * passes its props and ref through) and by its stand-in until the sheet's code has arrived
 * (`HelpSheet`, 6.0), so nothing moves when it does.
 */
export function HelpTrigger(props: ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="help-trigger"
      aria-label="About this screen"
      className="pressable text-muted-foreground active:bg-muted flex size-11 shrink-0 items-center justify-center rounded-lg md:hidden"
      {...props}
    >
      <InfoIcon className="size-4" aria-hidden />
    </button>
  );
}
