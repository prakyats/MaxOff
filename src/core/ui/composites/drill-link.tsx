import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/core/lib/utils";
import { NAV_FORWARD } from "@/core/ui/motion/nav-types";

/**
 * A link one level down the drill-down hierarchy: list → detail → sub-detail (ARCHITECTURE
 * §14.2 b). It pushes like any `Link` and carries the `nav-forward` type, so the installed app
 * slides the detail in (§14.2 j, task 2.7b). A drill-down reached from inside a sheet uses
 * `OverlayLink`, which carries the same type; tabs and view controls never do.
 */
export function DrillLink({
  className,
  ...props
}: Omit<ComponentProps<typeof Link>, "transitionTypes">) {
  // A drill-down is a row or a card: the row's pressed tint (`pressable-row`, §14.1).
  return (
    <Link {...props} className={cn("pressable-row", className)} transitionTypes={[NAV_FORWARD]} />
  );
}
