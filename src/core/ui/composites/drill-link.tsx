"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent, PointerEvent } from "react";

import { cn } from "@/core/lib/utils";
import { NAV_FORWARD } from "@/core/ui/motion/nav-types";
import { nameSlide } from "@/core/ui/motion/slide";
import { useLessData } from "@/core/ui/navigation/less-data";
import { isIntent, rowPrefetch } from "@/core/ui/navigation/prefetch-choice";

/**
 * A link one level down the drill-down hierarchy: list → detail → sub-detail (ARCHITECTURE
 * §14.2 b). It pushes like any `Link` and carries the `nav-forward` type, so the installed app
 * slides the detail in (§14.2 j, task 2.7b; the slide is also named on `<html>` at the tap,
 * `nameSlide`). A drill-down reached from inside a sheet uses
 * `OverlayLink`, which carries the same type; tabs and view controls never do.
 *
 * `prefetchRank` (P2 item 6, `navigation/prefetch-choice.ts`): a row of a list whose destination
 * reads its record in a layout (a client, a person) says where it stands, so only the first few
 * prefetch while in view and the rest on intent (the finger or the button going down, a mouse
 * resting on it), and none with data saver on. Without it the link prefetches as every `Link`.
 * Either way the prefetch is the router's own loading-boundary one, and nothing touches history.
 */
export function DrillLink({
  className,
  onClick,
  onPointerDown,
  onPointerEnter,
  prefetchRank,
  ...props
}: Omit<ComponentProps<typeof Link>, "transitionTypes"> & { prefetchRank?: number }) {
  const router = useRouter();
  const lessData = useLessData();
  const href = typeof props.href === "string" ? props.href : null;
  const choice =
    prefetchRank === undefined || href === null || props.prefetch !== undefined
      ? null
      : rowPrefetch(prefetchRank, lessData);
  const onIntent = (event: PointerEvent<HTMLAnchorElement>) => {
    if (choice === "intent" && href !== null && isIntent(event, lessData)) router.prefetch(href);
  };
  // A drill-down is a row or a card: the row's pressed tint (`pressable-row`, §14.1).
  return (
    <Link
      {...props}
      {...(choice === null ? {} : { prefetch: choice === "viewport" ? null : false })}
      className={cn("pressable-row", className)}
      transitionTypes={[NAV_FORWARD]}
      onPointerDown={(event: PointerEvent<HTMLAnchorElement>) => {
        onPointerDown?.(event);
        onIntent(event);
      }}
      onPointerEnter={(event: PointerEvent<HTMLAnchorElement>) => {
        onPointerEnter?.(event);
        onIntent(event);
      }}
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
