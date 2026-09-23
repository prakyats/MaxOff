import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";

import { HeaderBell } from "./header-bell";
import { HelpSheet } from "./help-sheet";

/**
 * The top of every page — and on a phone, **the app's title bar** (ARCHITECTURE §14.1, task 1.5).
 *
 * **Desktop** (`md` up): title, description and right-aligned actions, as before.
 *
 * **Phone**: a 44px sticky bar holding the back chevron, the title and the notification bell,
 * pinned directly under the brand bar and taking the top edge when that slides away. The
 * description does **not** render — an explanatory paragraph belongs in the empty state or
 * behind `help`, not in front of the first row of content — and `actions` moves to an extended
 * FAB above the bottom bar, because a primary action at the top of a scrolled page is out of
 * reach. `actions` is one element repositioned by CSS, not two copies, so a dialog trigger is
 * never mounted twice.
 */
export function PageHeader({
  title,
  description,
  /** A short explanation for a phone, where `description` is hidden. Opens a bottom sheet. */
  help,
  /** Where "up" goes from a sub-page, e.g. Settings → a section. */
  back,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  help?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <>
      {back ? (
        <Link
          href={back.href}
          data-slot="page-back"
          // On a phone the chevron lives inside the title bar below; this is the desktop one.
          className="text-muted-foreground hover:text-foreground mb-4 hidden items-center gap-1 text-sm md:inline-flex"
        >
          <ChevronLeftIcon className="size-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}

      <div
        data-slot="page-header"
        className={cn(
          // Phone: a full-bleed sticky title bar under the brand bar. The background is opaque
          // on purpose: `backdrop-filter` would make this a containing block, and the `fixed`
          // action below would then be positioned against the bar instead of the viewport.
          "border-border bg-background sticky top-[var(--app-chrome-h)] z-20 -mx-4 mb-4 flex min-h-11 items-center gap-1 border-b px-2",
          // Desktop: the title block it has always been.
          "md:static md:mx-0 md:mb-6 md:min-h-0 md:items-start md:gap-3 md:border-0 md:px-0",
          className,
        )}
      >
        {back ? (
          <Link
            href={back.href}
            aria-label={`Back to ${back.label}`}
            className="text-muted-foreground active:bg-muted -ml-1 flex size-11 shrink-0 items-center justify-center rounded-lg md:hidden"
          >
            <ChevronLeftIcon className="size-5" aria-hidden />
          </Link>
        ) : null}

        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-0.5 md:block",
            !back && "ml-2 md:ml-0",
          )}
        >
          <h1 className="min-w-0 truncate text-base font-semibold tracking-tight md:text-2xl">
            {title}
          </h1>
          {help ? <HelpSheet title={title}>{help}</HelpSheet> : null}
          {description ? (
            <p className="text-muted-foreground mt-1 hidden text-sm md:block">{description}</p>
          ) : null}
        </div>

        <HeaderBell />

        {actions ? (
          <div
            data-slot="page-actions"
            // One node, two positions: an extended FAB above the bottom bar on a phone, the
            // header's right-hand side on desktop. `globals.css` gives a page that has one
            // extra bottom padding, so the FAB never covers the last row.
            className={cn(
              "fixed right-4 bottom-[calc(var(--app-bottom-nav-h)+1rem+var(--app-safe-bottom))] z-30 flex items-center gap-2",
              "*:h-12 *:rounded-full *:px-5 *:shadow-lg",
              "md:static md:shrink-0 md:flex-wrap md:*:h-8 md:*:rounded-lg md:*:px-2.5 md:*:shadow-none",
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </>
  );
}
