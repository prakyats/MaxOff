import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ViewLink } from "@/core/ui/composites/view-link";
import { Button } from "@/core/ui/primitives/button";

/**
 * Alerts' pager, under the list (only past one page): newer to the left, older to the right.
 * `ViewLink`s: paging never adds history (ARCHITECTURE §14.2 d).
 */
export function AlertsPager({
  label,
  previous,
  next,
}: {
  label: string;
  previous: string | null;
  next: string | null;
}) {
  return (
    <div data-slot="alerts-pager" className="mt-3 flex min-h-11 items-center justify-between gap-2">
      <PagerLink href={previous} label="Newer alerts">
        <ChevronLeftIcon aria-hidden />
      </PagerLink>
      <p className="min-w-0 text-center text-sm font-medium tabular-nums" aria-live="polite">
        {label}
      </p>
      <PagerLink href={next} label="Older alerts">
        <ChevronRightIcon aria-hidden />
      </PagerLink>
    </div>
  );
}

function PagerLink({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: ReactNode;
}) {
  if (!href) {
    return (
      <Button variant="ghost" size="icon" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="ghost" size="icon" asChild>
      <ViewLink href={href} aria-label={label} icon>
        {children}
      </ViewLink>
    </Button>
  );
}
