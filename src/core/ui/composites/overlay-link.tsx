"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";

/**
 * A drill-down link **inside an overlay** (a review sheet, a detail sheet, a row menu): the
 * overlay's own history entry is backed out first, then the page is pushed, so back from the
 * new page lands on the list with the overlay closed, never on a stale overlay entry
 * (ARCHITECTURE §14.2 a, b). Outside an overlay it is an ordinary link.
 */
export function OverlayLink({
  href,
  onClick,
  ...props
}: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      {...props}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        closeOverlaysThen(() => router.push(href));
      }}
    />
  );
}
