"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";

import { cn } from "@/core/lib/utils";
import { NAV_FORWARD } from "@/core/ui/motion/nav-types";
import { nameSlide } from "@/core/ui/motion/slide";

/**
 * A link one level down the drill-down hierarchy: list → detail → sub-detail (ARCHITECTURE
 * §14.2 b). It pushes like any `Link` and carries the `nav-forward` type, so the installed app
 * slides the detail in (§14.2 j, task 2.7b; the slide is also named on `<html>` at the tap,
 * `nameSlide`). A drill-down reached from inside a sheet uses
 * `OverlayLink`, which carries the same type; tabs and view controls never do.
 */
export function DrillLink({
  className,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, "transitionTypes">) {
  // A drill-down is a row or a card: the row's pressed tint (`pressable-row`, §14.1).
  return (
    <Link
      {...props}
      className={cn("pressable-row", className)}
      transitionTypes={[NAV_FORWARD]}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
        // The slide's name beside the type: the type alone is lost when the tap lands while the
        // screen is still hydrating (`slide.ts`).
        nameSlide("forward");
      }}
    />
  );
}
