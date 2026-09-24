import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { ViewLink } from "@/core/ui/composites/view-link";
import { Button } from "@/core/ui/primitives/button";

/**
 * One row above a list: where you are, and the way to the previous and next page (the requests,
 * only when there is more than one) or month (the attendance).
 * The arrows are `ViewLink`s too: paging never adds history.
 */
export function LeavePager({
  label,
  previous,
  next,
  previousLabel,
  nextLabel,
}: {
  label: string;
  previous: string | null;
  next: string | null;
  previousLabel: string;
  nextLabel: string;
}) {
  return (
    <div data-slot="leave-pager" className="mb-3 flex min-h-11 items-center justify-between gap-2">
      <PagerLink href={previous} label={previousLabel}>
        <ChevronLeftIcon aria-hidden />
      </PagerLink>
      <p className="text-sm font-medium tabular-nums" aria-live="polite">
        {label}
      </p>
      <PagerLink href={next} label={nextLabel}>
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
  children: React.ReactNode;
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
