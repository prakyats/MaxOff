"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

import { cn } from "@/core/lib/utils";
import { NAV_BACK } from "@/core/ui/motion/nav-types";
import { nameSlide, slideBack } from "@/core/ui/motion/slide";
import { markLive } from "@/core/ui/navigation/attributes";
import { backMove } from "@/core/ui/navigation/moves";

type NavigationLike = { currentEntry?: { index: number } | null };

function currentIndex(): number | undefined {
  const navigation = (window as { navigation?: NavigationLike }).navigation;
  return navigation?.currentEntry?.index;
}

/**
 * The back control in a drill-down screen's header (`PageHeader` `back`). A real link to the
 * parent, so it opens in a new tab like one; a plain tap is handled by `backMove()`
 * (`navigation/moves.ts`), before hydration too (`navigation/pre-hydration.ts`, task 2.8).
 * **An installed iOS app has no system back gesture**, so every drill-down screen carries one
 * (§14.2 k).
 */
export function BackLink({
  href,
  onClick,
  className,
  ...props
}: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      data-slot="page-back"
      {...props}
      className={cn("pressable", className)}
      ref={markLive}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        // Both moves slide back out in the installed app (§14.2 j): the replace through its
        // transition type and the slide's name (`nameSlide`: the type alone is lost when the tap
        // lands while the screen is still hydrating), the back through `slideBack`, since a
        // history move carries no type.
        if (backMove(currentIndex()) === "back") slideBack(() => router.back());
        else {
          nameSlide("back");
          router.replace(href, { transitionTypes: [NAV_BACK] });
        }
      }}
    />
  );
}
