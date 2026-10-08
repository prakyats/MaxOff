"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

import { cn } from "@/core/lib/utils";
import { NAV_FORWARD } from "@/core/ui/motion/nav-types";
import { nameSlide } from "@/core/ui/motion/slide";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";

/**
 * A drill-down link **inside an overlay** (a review sheet, a detail sheet, a row menu): the
 * overlay's own history entry is backed out first, then the page is pushed, so back from the
 * new page lands on the list with the overlay closed, never on a stale overlay entry
 * (ARCHITECTURE §14.2 a, b). Outside an overlay it is an ordinary link. Either way the push
 * carries `nav-forward`, so the installed app slides the detail in (§14.2 j, like `DrillLink`).
 */
export function OverlayLink({
  href,
  onClick,
  className,
  ...props
}: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      {...props}
      className={cn("pressable-row", className)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        closeOverlaysThen(() => {
          nameSlide("forward");
          router.push(href, { transitionTypes: [NAV_FORWARD] });
        });
      }}
    />
  );
}
