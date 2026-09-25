"use client";

import { Loader2Icon } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { viewMove } from "@/core/ui/navigation/moves";
import { markLive, VIEW_LINK_ATTRIBUTE } from "@/core/ui/navigation/attributes";

/**
 * A link that changes **the view of the page you are on**, not the page: a tab, a pager arrow,
 * a month switcher, a filter (ARCHITECTURE §14.1, the 2.3 back-gesture fix).
 *
 * The rule: in-page view controls never add history. The URL still follows the view — so a
 * refresh or a shared link keeps the place — but through `replace`, so one back always leaves
 * the page to wherever the member came from. With a plain `Link`, switching tabs three times on
 * /leave took three back gestures to leave it (found on an installed phone).
 *
 * The tapped control shows its pending state at once (`useLinkStatus`), so a slow connection
 * never looks like a dead tap: text dims and pulses in place, an icon becomes a spinner of the
 * same size — nothing moves.
 *
 * `view-links.test.ts` sweeps the source for same-page query links and router calls that push.
 */
export function ViewLink({
  children,
  icon = false,
  ...props
}: Omit<ComponentProps<typeof Link>, "replace"> & {
  /** The child is a single icon: while pending it is swapped for a spinner of the same size. */
  icon?: boolean;
}) {
  return (
    // `data-view-link` lets the pre-hydration script replace too (task 2.8).
    <Link
      {...props}
      replace={viewMove() === "replace"}
      {...{ [VIEW_LINK_ATTRIBUTE]: "" }}
      ref={markLive}
    >
      <ViewLinkContent icon={icon}>{children}</ViewLinkContent>
    </Link>
  );
}

function ViewLinkContent({ icon, children }: { icon: boolean; children: ReactNode }) {
  const { pending } = useLinkStatus();
  if (icon) {
    return pending ? (
      <Loader2Icon data-slot="view-link-pending" aria-hidden className="animate-spin" />
    ) : (
      children
    );
  }
  return (
    <span
      data-slot={pending ? "view-link-pending" : undefined}
      className={pending ? "animate-pulse opacity-60 motion-reduce:animate-none" : undefined}
    >
      {children}
    </span>
  );
}
