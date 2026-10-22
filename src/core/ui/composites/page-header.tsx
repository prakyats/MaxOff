import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";

import { BackLink, type BackOrigin } from "./back-link";
import { HeaderBell } from "./header-bell";
import { HomeMark } from "./home-mark";
import { HelpSheet } from "./help-sheet";

/**
 * The top of every page — and on a phone, **the app's title bar** (ARCHITECTURE §14.1, task 1.5).
 *
 * **Desktop** (`md` up): title, description and right-aligned actions, as before.
 *
 * **Phone**: **the one header bar** (L4: no brand bar above it), a 44px bar sticky at the top
 * edge holding the back chevron (or, on a top-level tab, the MaxOff mark that goes home by replace), the title,
 * the record's ⋯ menu and the notification bell. The
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
  /**
   * The parent of a drill-down screen (Settings → a section, People → a person). Every
   * drill-down screen has one (ARCHITECTURE §14.2 k): `BackLink` goes back when the page beneath
   * is this parent, an ancestor of it or one of `from` (the other screens this one is drilled
   * into from, which the label then names), and otherwise to this parent with replace.
   * `labelWidth` is for a loading screen whose parent's name is not read yet (a project's
   * client): the desktop label is traced as a bar of that width instead of words.
   */
  back,
  actions,
  menu,
  status,
  history,
  primary,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  help?: ReactNode;
  back?: { href: string; label: string; labelWidth?: string; from?: readonly BackOrigin[] };
  actions?: ReactNode;
  /**
   * A record's ⋯ menu (3.4: a person, a client). Unlike `actions` it stays in the title bar on
   * a phone, next to the bell: it holds occasional actions (Edit, Deactivate, Pause…), not the
   * screen's primary one.
   */
  menu?: ReactNode;
  /**
   * The detail header (FINAL 6, `DetailHeader`): the record's status chip right after the title.
   * Laptop only: the phone's 44 px bar has no room beside History, ⋯ and the bell, so a phone
   * keeps the state on the page's first-glance line under the bar.
   */
  status?: ReactNode;
  /** The record's History clock (`HistoryButton` / `HistorySheet`), just before ⋯. */
  history?: ReactNode;
  /**
   * The page's one primary action on a laptop, in the header's action area beside History (e.g.
   * Crew's Mark done, PP-crew-8). Laptop only: on a phone the same action is the sticky bottom
   * bar (`StickyActions`), which the caller draws.
   */
  primary?: ReactNode;
  className?: string;
}) {
  return (
    <>
      {back ? (
        <BackLink
          href={back.href}
          label={back.label}
          from={back.from}
          labelWidth={back.labelWidth}
          variant="text"
          // On a phone the chevron lives inside the title bar below; this is the desktop one.
          className="text-muted-foreground hover:text-foreground mb-4 hidden items-center gap-1 text-sm md:inline-flex"
        />
      ) : null}

      <div
        data-slot="page-header"
        className={cn(
          // Phone: the one full-bleed header bar, sticky at the top edge (below a notch, if any).
          // The background is opaque on purpose: `backdrop-filter` would make this a containing
          // block, and the `fixed` action below would then be positioned against the bar instead
          // of the viewport.
          "border-border bg-background sticky top-0 z-20 -mx-4 mb-4 flex min-h-11 items-center gap-1 border-b px-2 pt-[var(--app-safe-top)]",
          // Desktop: the title block it has always been.
          "md:static md:mx-0 md:mb-6 md:min-h-0 md:items-start md:gap-3 md:border-0 md:px-0 md:pt-0",
          className,
        )}
      >
        {back ? (
          <BackLink
            href={back.href}
            label={back.label}
            from={back.from}
            variant="icon"
            className="text-muted-foreground active:bg-muted -ml-1 flex size-11 shrink-0 items-center justify-center rounded-lg md:hidden"
          />
        ) : (
          <HomeMark />
        )}

        <div className="flex min-w-0 flex-1 items-center gap-0.5 md:block">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="line-clamp-2 min-w-0 text-base font-semibold tracking-tight break-words md:text-2xl">
              {title}
            </h1>
            {status ? (
              <span data-slot="page-status" className="hidden shrink-0 md:inline-flex">
                {status}
              </span>
            ) : null}
          </div>
          {help ? <HelpSheet title={title}>{help}</HelpSheet> : null}
          {description ? (
            <p className="text-muted-foreground mt-1 hidden text-sm md:block">{description}</p>
          ) : null}
        </div>

        {primary ? (
          <div
            data-slot="page-primary"
            className="hidden shrink-0 items-center gap-2 md:order-last md:flex"
          >
            {primary}
          </div>
        ) : null}

        {menu || history ? (
          <div data-slot="page-menu" className="flex shrink-0 items-center md:order-last">
            {history}
            {menu}
          </div>
        ) : null}

        <HeaderBell />

        {actions ? (
          <div
            data-slot="page-actions"
            // One node, two positions: an extended FAB above the bottom bar on a phone, the
            // header's right-hand side on desktop. `globals.css` gives a page that has one
            // extra bottom padding, so the FAB never covers the last row.
            className={cn(
              "fixed right-4 bottom-[calc(var(--app-bottom-nav-h)+1rem+var(--app-safe-bottom)+var(--app-bands-h,0px))] z-30 flex items-center gap-2",
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

/**
 * **The detail header** (FINAL 6; V5b): back · title · status chip, then on the right the page's
 * one primary action (laptop), the History clock, then ⋯; the bell after them on a phone. Every
 * record page uses it (task, project, client, person). The phone's primary action is the sticky
 * bottom bar (`StickyActions`), drawn by the page.
 */
export function DetailHeader(
  props: Omit<Parameters<typeof PageHeader>[0], "actions"> & {
    back: NonNullable<Parameters<typeof PageHeader>[0]["back"]>;
  },
) {
  return <PageHeader {...props} />;
}
