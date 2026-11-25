import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { DrillLink } from "./drill-link";

/**
 * A "more, one tap deeper" row under a tab's first screen (PRODUCT §2): a bordered card-height
 * link with its words and a chevron, such as Tasks' "On hold · 2" or "All tasks, with filters", and
 * My Day's own "On hold" line (v2.0 review P4, v7.0: one component, not a hand copy).
 */
export function MoreLink({
  href,
  slot,
  children,
}: {
  href: string;
  slot: string;
  children: ReactNode;
}) {
  return (
    <DrillLink
      href={href}
      data-slot={slot}
      className="border-border bg-card focus-visible:ring-ring flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium outline-none focus-visible:ring-2"
    >
      <span className="min-w-0 break-words">{children}</span>
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </DrillLink>
  );
}
